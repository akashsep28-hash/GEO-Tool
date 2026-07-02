/**
 * Actor-aware data access for per-page audit records.
 * Authenticated users -> Supabase `audit_pages` table.
 * Guests -> cookie-keyed in-memory store (lib/guest-session.ts).
 */
import "server-only";
import { getActor } from "@/lib/actor";
import type { PageAiAnalysis } from "@/lib/audit-agent";
import type { AuditPageRecord } from "@/lib/audit-engine";
import { getGuestPageById, getGuestPages, guestPageId, saveGuestPageAi } from "@/lib/guest-session";
import { createClient } from "@/lib/supabase/server";

export type AiStatus = "pending" | "running" | "done" | "error";

export type PageListItem = {
	id: string;
	url: string;
	title: string;
	status: number;
	ok: boolean;
	wordCount: number;
	htmlBytes: number;
	issueCount: number;
	workingCount: number;
	notWorkingCount: number;
	aiStatus: AiStatus;
};

export type PageDetail = {
	id: string;
	record: AuditPageRecord;
	ai: PageAiAnalysis | null;
	aiStatus: AiStatus;
	aiError?: string | null;
};

/** Persist all crawled pages for an authenticated user's audit. */
export async function saveAuditPages(auditId: string, userId: string, pages: AuditPageRecord[]): Promise<void> {
	if (!pages.length) return;
	const supabase = await createClient();
	const rows = pages.map(p => ({
		audit_id: auditId,
		user_id: userId,
		url: p.url,
		requested_url: p.requestedUrl,
		status: p.status,
		ok: p.ok,
		title: p.title,
		meta_description: p.metaDescription,
		word_count: p.wordCount,
		html_bytes: p.htmlBytes,
		html: p.html,
		page_text: p.text,
		signals: p.signals,
		rule_issues: p.ruleIssues,
		working: p.working,
		not_working: p.notWorking,
		ai_status: "pending" as AiStatus,
	}));
	await supabase.from("audit_pages").insert(rows);
}

/** List pages for a given audit id ("guest" for guest mode). */
export async function listAuditPages(auditId: string): Promise<PageListItem[]> {
	const actor = await getActor();

	if (actor.kind === "guest") {
		const pages = await getGuestPages();
		const detail = await Promise.all(
			pages.map(async p => {
				const found = await getGuestPageById(guestPageId(p.url));
				return { p, ai: found?.ai ?? null };
			}),
		);
		return detail.map(({ p, ai }) => ({
			id: guestPageId(p.url),
			url: p.url,
			title: p.title,
			status: p.status,
			ok: p.ok,
			wordCount: p.wordCount,
			htmlBytes: p.htmlBytes,
			issueCount: p.ruleIssues.length,
			workingCount: p.working.length,
			notWorkingCount: p.notWorking.length,
			aiStatus: ai ? "done" : "pending",
		}));
	}

	const supabase = await createClient();
	const { data } = await supabase
		.from("audit_pages")
		.select("id, url, title, status, ok, word_count, html_bytes, rule_issues, working, not_working, ai_status")
		.eq("audit_id", auditId)
		.order("word_count", { ascending: false });

	return (data ?? []).map(r => ({
		id: r.id,
		url: r.url,
		title: r.title ?? "",
		status: r.status ?? 0,
		ok: r.ok ?? false,
		wordCount: r.word_count ?? 0,
		htmlBytes: r.html_bytes ?? 0,
		issueCount: (r.rule_issues as string[] | null)?.length ?? 0,
		workingCount: (r.working as string[] | null)?.length ?? 0,
		notWorkingCount: (r.not_working as string[] | null)?.length ?? 0,
		aiStatus: (r.ai_status as AiStatus) ?? "pending",
	}));
}

function rowToRecord(r: Record<string, unknown>): AuditPageRecord {
	return {
		url: r.url as string,
		requestedUrl: (r.requested_url as string) ?? (r.url as string),
		status: (r.status as number) ?? 0,
		ok: (r.ok as boolean) ?? false,
		title: (r.title as string) ?? "",
		metaDescription: (r.meta_description as string) ?? "",
		wordCount: (r.word_count as number) ?? 0,
		htmlBytes: (r.html_bytes as number) ?? 0,
		html: (r.html as string) ?? "",
		text: (r.page_text as string) ?? "",
		signals: r.signals as AuditPageRecord["signals"],
		ruleIssues: (r.rule_issues as string[]) ?? [],
		working: (r.working as string[]) ?? [],
		notWorking: (r.not_working as string[]) ?? [],
	};
}

export async function getAuditPage(pageId: string): Promise<PageDetail | null> {
	const actor = await getActor();

	if (actor.kind === "guest") {
		const found = await getGuestPageById(pageId);
		if (!found) return null;
		return {
			id: pageId,
			record: found.record,
			ai: found.ai,
			aiStatus: found.ai ? "done" : "pending",
		};
	}

	const supabase = await createClient();
	const { data } = await supabase.from("audit_pages").select("*").eq("id", pageId).maybeSingle();
	if (!data) return null;
	return {
		id: data.id,
		record: rowToRecord(data),
		ai: (data.ai_analysis as PageAiAnalysis | null) ?? null,
		aiStatus: (data.ai_status as AiStatus) ?? "pending",
		aiError: data.ai_error ?? null,
	};
}

/** Fetch the full page record needed to run the agent. */
export async function getPageRecordForAgent(pageId: string): Promise<AuditPageRecord | null> {
	const detail = await getAuditPage(pageId);
	return detail?.record ?? null;
}

export async function setPageAiStatus(pageId: string, status: AiStatus, error?: string): Promise<void> {
	const actor = await getActor();
	if (actor.kind === "guest") return; // guest analysis is synchronous, in-memory
	const supabase = await createClient();
	await supabase
		.from("audit_pages")
		.update({ ai_status: status, ai_error: error ?? null })
		.eq("id", pageId);
}

/**
 * Persist a partial AI result mid-run so the page can surface each stage's
 * output as soon as it lands. Keeps ai_status "running" — savePageAi() flips
 * it to "done" with the final result.
 */
export async function savePageAiProgress(pageId: string, ai: PageAiAnalysis): Promise<void> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		await saveGuestPageAi(pageId, ai);
		return;
	}
	const supabase = await createClient();
	await supabase
		.from("audit_pages")
		.update({ ai_analysis: ai, ai_status: "running", ai_model: ai.model, ai_error: null })
		.eq("id", pageId);
}

export async function savePageAi(pageId: string, ai: PageAiAnalysis): Promise<void> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		await saveGuestPageAi(pageId, ai);
		return;
	}
	const supabase = await createClient();
	await supabase
		.from("audit_pages")
		.update({
			ai_analysis: ai,
			ai_status: "done",
			ai_model: ai.model,
			ai_error: null,
		})
		.eq("id", pageId);
}
