"use server";

import { revalidatePath } from "next/cache";
import type { DeviceMode } from "@/lib/browser";
import { analyzePageGapWithAi } from "@/lib/page-gap-llm";
import { runPageGap } from "@/lib/page-gap-run";
import { type DraftContentResult, draftRecommendedContent, generatePageSchema } from "@/lib/page-gap-schema";
import {
	getPageGapRun,
	savePageGapLlm,
	savePageGapRun,
	savePageGapSchema,
	setPageGapLlmStatus,
	setPageGapSchemaStatus,
} from "@/lib/page-gap-store";

export type RunPageGapInput = {
	url: string;
	keyword: string;
	country?: string;
	device?: DeviceMode;
	/** Headed mode: open a visible Chrome window to clear Google's bot check. */
	interactive?: boolean;
};

export type RunPageGapResult = {
	ok: boolean;
	error?: string;
	runId?: string;
};

function normaliseInputUrl(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;
	try {
		const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
		return new URL(withProto).toString();
	} catch {
		return null;
	}
}

/** Run the full deterministic Page Gap analysis and persist it. */
export async function runPageGapAction(input: RunPageGapInput): Promise<RunPageGapResult> {
	try {
		const url = normaliseInputUrl(input.url);
		if (!url) return { ok: false, error: "Enter a valid target page URL." };
		const keyword = input.keyword.trim();
		if (!keyword) return { ok: false, error: "Enter a target keyword." };

		const result = await runPageGap(url, keyword, {
			country: input.country,
			device: input.device,
			interactive: input.interactive,
		});

		// No SERP results means there is nothing to benchmark against — the score
		// would be meaningless. Fail loudly instead of saving a misleading report.
		if (result.serp.results.length === 0) {
			return {
				ok: false,
				error:
					result.serp.error ??
					"The SERP returned no organic results, so there are no competitors to source gaps from.",
			};
		}

		const runId = await savePageGapRun(result);
		revalidatePath("/page-gap");
		return { ok: true, runId };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

/** Generate the once-per-run LLM narrative for a stored run. */
export async function analyzePageGapAiAction(runId: string): Promise<{ ok: boolean; error?: string }> {
	try {
		const run = await getPageGapRun(runId);
		if (!run) return { ok: false, error: "Run not found." };

		await setPageGapLlmStatus(runId, "running");
		try {
			const llm = await analyzePageGapWithAi(run.report);
			await savePageGapLlm(runId, llm);
		} catch (e) {
			await setPageGapLlmStatus(runId, "error", (e as Error).message);
			return { ok: false, error: (e as Error).message };
		}

		revalidatePath("/page-gap");
		revalidatePath(`/page-gap/${runId}`);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

/** Generate Schema.org JSON-LD for the target page of a stored run. */
export async function generatePageGapSchemaAction(runId: string): Promise<{ ok: boolean; error?: string }> {
	try {
		const run = await getPageGapRun(runId);
		if (!run) return { ok: false, error: "Run not found." };

		await setPageGapSchemaStatus(runId, "running");
		try {
			// Prefer the AI-refined GEO Prompt Finder (richer prompts) when present.
			const schema = await generatePageSchema(run.report, {
				promptFinder: run.llm?.promptFinder ?? run.report.promptFinder,
			});
			await savePageGapSchema(runId, schema);
		} catch (e) {
			await setPageGapSchemaStatus(runId, "error", (e as Error).message);
			return { ok: false, error: (e as Error).message };
		}

		revalidatePath(`/page-gap/${runId}`);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

/**
 * Draft grounded FAQ content for the "Content needed" recommendations of a run.
 * Returns page-ready copy + matching FAQ JSON-LD (to deploy only after the copy
 * is published on the page). Does not persist — it's an on-demand draft.
 */
export async function draftPageGapContentAction(
	runId: string,
	questions: string[],
): Promise<{ ok: boolean; error?: string; result?: DraftContentResult }> {
	try {
		const run = await getPageGapRun(runId);
		if (!run) return { ok: false, error: "Run not found." };
		const result = await draftRecommendedContent(run.report, questions, {
			promptFinder: run.llm?.promptFinder ?? run.report.promptFinder,
		});
		return { ok: true, result };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
