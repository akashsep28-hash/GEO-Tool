"use server";

import { revalidatePath } from "next/cache";
import { analyzePageWithAi } from "@/lib/audit-agent";
import { getPageRecordForAgent, listAuditPages, savePageAi, setPageAiStatus } from "@/lib/audit-pages";

export type AgentResult = { ok: boolean; error?: string };

/** Run the AI auditor agent on a single stored page. */
export async function analyzePageAction(pageId: string): Promise<AgentResult> {
	try {
		const record = await getPageRecordForAgent(pageId);
		if (!record) return { ok: false, error: "Page not found." };

		await setPageAiStatus(pageId, "running");
		try {
			const ai = await analyzePageWithAi(record);
			await savePageAi(pageId, ai);
		} catch (e) {
			await setPageAiStatus(pageId, "error", (e as Error).message);
			return { ok: false, error: (e as Error).message };
		}

		revalidatePath("/audit");
		revalidatePath(`/audit/page/${pageId}`);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export type BatchResult = {
	ok: boolean;
	error?: string;
	processed?: number;
	remaining?: number;
};

/**
 * Analyze up to `limit` not-yet-analyzed pages for an audit, sequentially.
 * Returns how many remain so the UI can keep the progress bar moving by
 * re-invoking until remaining === 0 (keeps each request bounded for slow
 * local models).
 */
export async function analyzeAllPagesAction(auditId: string, limit = 3): Promise<BatchResult> {
	try {
		const pages = await listAuditPages(auditId);
		const pending = pages.filter(p => p.ok && p.aiStatus === "pending");
		const batch = pending.slice(0, limit);

		let processed = 0;
		for (const p of batch) {
			const record = await getPageRecordForAgent(p.id);
			if (!record) continue;
			await setPageAiStatus(p.id, "running");
			try {
				const ai = await analyzePageWithAi(record);
				await savePageAi(p.id, ai);
				processed++;
			} catch (e) {
				await setPageAiStatus(p.id, "error", (e as Error).message);
			}
		}

		revalidatePath("/audit");
		return {
			ok: true,
			processed,
			remaining: Math.max(0, pending.length - processed),
		};
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
