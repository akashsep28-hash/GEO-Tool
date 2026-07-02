/**
 * Streaming single-page audit AI endpoint.
 *
 * Runs the auditor micro-agent pipeline (lib/audit-agent.ts) for one stored
 * page and streams NDJSON activity events — which agent is thinking, retries
 * and their reasons, gating decisions, the patching phase — so the "Run AI
 * analysis" button can show real progress instead of a static spinner.
 * Mirrors the page-gap streaming routes.
 */
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { withAgentEvents } from "@/lib/agent-runner";
import { analyzePageWithAi } from "@/lib/audit-agent";
import { getPageRecordForAgent, savePageAi, savePageAiProgress, setPageAiStatus } from "@/lib/audit-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ pageId: string }> }) {
	const { pageId } = await ctx.params;
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
			try {
				const record = await getPageRecordForAgent(pageId);
				if (!record) {
					send({ type: "error", error: "Page not found." });
					return;
				}

				await setPageAiStatus(pageId, "running");
				send({ type: "progress", label: "Reading stored page & rule verdicts" });
				try {
					const ai = await withAgentEvents(
						e => send({ type: "activity", ...e }),
						() =>
							analyzePageWithAi(record, {
								// Persist each stage's output the moment it's ready and tell
								// the client, so the page fills in while later agents run.
								onPartial: async partial => {
									await savePageAiProgress(pageId, partial);
									revalidatePath(`/audit/page/${pageId}`);
									send({ type: "partial" });
								},
							}),
					);
					await savePageAi(pageId, ai);
				} catch (e) {
					const msg = (e as Error).message;
					await setPageAiStatus(pageId, "error", msg);
					send({ type: "error", error: msg });
					return;
				}

				revalidatePath("/audit");
				revalidatePath(`/audit/page/${pageId}`);
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
