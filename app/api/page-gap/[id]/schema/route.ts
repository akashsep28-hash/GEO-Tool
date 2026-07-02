/**
 * Streaming schema-generation endpoint for a Page Gap run.
 *
 * Same work as generatePageGapSchemaAction, but streams NDJSON activity so the
 * "Generate schema" button can narrate the two agents (extraction +
 * existing-schema audit) and the deterministic graph assembly live.
 */
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { withAgentEvents } from "@/lib/agent-runner";
import { generatePageSchema } from "@/lib/page-gap-schema";
import { getPageGapRun, savePageGapSchema, setPageGapSchemaStatus } from "@/lib/page-gap-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
			try {
				const run = await getPageGapRun(id);
				if (!run) {
					send({ type: "error", error: "Run not found." });
					return;
				}

				await setPageGapSchemaStatus(id, "running");
				send({ type: "progress", label: "Planning the schema set (existing JSON-LD + gaps + SERP prevalence)" });
				try {
					const schema = await withAgentEvents(
						e => send({ type: "activity", ...e }),
						() =>
							generatePageSchema(run.report, {
								promptFinder: run.llm?.promptFinder ?? run.report.promptFinder,
							}),
					);
					await savePageGapSchema(id, schema);
				} catch (e) {
					const msg = (e as Error).message;
					await setPageGapSchemaStatus(id, "error", msg);
					send({ type: "error", error: msg });
					return;
				}

				revalidatePath(`/page-gap/${id}`);
				send({ type: "done" });
			} catch (e) {
				send({ type: "error", error: (e as Error).message });
			} finally {
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
