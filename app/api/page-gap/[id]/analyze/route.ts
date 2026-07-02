/**
 * Streaming per-section AI analysis endpoint.
 *
 * The AI narrative is now produced in five lighter, section-scoped LLM calls
 * (lib/page-gap-llm.ts) instead of one heavy call. This route runs them in
 * sequence and streams NDJSON progress so the "Generate AI analysis" button can
 * show a live loader naming the section being worked on. After each section it
 * persists the accumulated output (status "running") so a mid-run refresh shows
 * partial results; the final write flips status to "done".
 *
 * Mirrors app/api/page-gap/run/route.ts. No new guest cookie is created here
 * (the run already exists), so there is no post-flush cookie concern.
 */
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { withAgentEvents } from "@/lib/agent-runner";
import {
	analyzeCompetitorSection,
	analyzeIntentSection,
	analyzePageGapSection,
	analyzePromptsSection,
	analyzeStructureSection,
	emptyLlm,
	type PageGapLlm,
} from "@/lib/page-gap-llm";
import { getPageGapRun, savePageGapLlm, setPageGapLlmStatus, updatePageGapLlmProgress } from "@/lib/page-gap-store";

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

				const sections: { label: string; fn: () => Promise<Partial<PageGapLlm>> }[] = [
					{ label: "Competitor Analysis", fn: () => analyzeCompetitorSection(run.report) },
					{ label: "SERP Intent Analysis", fn: () => analyzeIntentSection(run.report) },
					{ label: "Page Gap Analysis", fn: () => analyzePageGapSection(run.report) },
					{ label: "Prompts for GEO Mentions & Citation", fn: () => analyzePromptsSection(run.report) },
					{ label: "Page structure blueprint", fn: () => analyzeStructureSection(run.report) },
				];

				await setPageGapLlmStatus(id, "running");

				// Seed from any existing analysis so a regenerate keeps prior output
				// visible until each section is replaced.
				const llm: PageGapLlm = run.llm ?? emptyLlm("ai");
				const total = sections.length;
				const errors: string[] = [];
				let succeeded = 0;

				for (let i = 0; i < total; i++) {
					const s = sections[i];
					send({ type: "progress", step: i + 1, total, label: s.label });
					try {
						// Forward per-agent activity (generating / retrying-with-reason /
						// done) so the button can narrate what's happening inside the
						// section instead of sitting on a static label for minutes.
						const slice = await withAgentEvents(e => send({ type: "activity", ...e }), s.fn);
						Object.assign(llm, slice);
						llm.generatedAt = new Date().toISOString();
						succeeded++;
						await updatePageGapLlmProgress(id, llm);
						// Tell the client this section's output is persisted NOW, so the
						// report can surface it immediately (not when the next one starts).
						send({ type: "partial", step: i + 1, total, label: s.label });
					} catch (e) {
						errors.push(`${s.label}: ${(e as Error).message}`);
					}
				}

				if (succeeded === 0) {
					const msg = errors[0] ?? "AI analysis failed.";
					await setPageGapLlmStatus(id, "error", msg);
					send({ type: "error", error: msg });
					return;
				}

				await savePageGapLlm(id, llm);
				revalidatePath("/page-gap");
				revalidatePath(`/page-gap/${id}`);
				send({ type: "done", partialErrors: errors });
			} catch (e) {
				try {
					await setPageGapLlmStatus(id, "error", (e as Error).message);
				} catch {
					/* best effort */
				}
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
