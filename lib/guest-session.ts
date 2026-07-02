import "server-only";
import { cookies } from "next/headers";
import type { PageAiAnalysis } from "@/lib/audit-agent";
import type { AuditPageRecord, AuditResult, Finding } from "@/lib/audit-engine";
import type { PageGapLlm } from "@/lib/page-gap-llm";
import type { PageGapResult } from "@/lib/page-gap-run";
import type { SchemaResult } from "@/lib/page-gap-schema";

const GUEST_COOKIE = "first_ranker_guest";

export type GuestLlmStatus = "pending" | "running" | "done" | "error";

export type GuestPageGapRun = {
	id: string;
	report: PageGapResult;
	llm: PageGapLlm | null;
	llmStatus: GuestLlmStatus;
	llmError?: string | null;
	schema?: SchemaResult | null;
	schemaStatus?: GuestLlmStatus;
	schemaError?: string | null;
	created_at: string;
};

/** Stable id for a guest page (base64url of its URL). */
export function guestPageId(url: string): string {
	return Buffer.from(url).toString("base64url");
}

export type GuestProject = {
	id: "guest";
	name: string;
	website_url: string;
	industry: string | null;
};

export type GuestAudit = {
	id: "guest";
	score: number;
	created_at: string;
	summary: AuditResult["stats"] & {
		dimensions: AuditResult["dimensions"];
	};
	findings: Finding[];
	pages: AuditPageRecord[];
	pageAi: Record<string, PageAiAnalysis>;
};

type GuestState = {
	project?: GuestProject;
	audit?: GuestAudit;
	pageGapRuns?: Record<string, GuestPageGapRun>;
};

type GuestGlobal = typeof globalThis & {
	__FIRST_RANKER_GUEST_STORE__?: Map<string, GuestState>;
};

function store(): Map<string, GuestState> {
	const g = globalThis as GuestGlobal;
	if (!g.__FIRST_RANKER_GUEST_STORE__) {
		g.__FIRST_RANKER_GUEST_STORE__ = new Map();
	}
	return g.__FIRST_RANKER_GUEST_STORE__;
}

function randomId(): string {
	return crypto.randomUUID();
}

export async function getGuestId(): Promise<string | null> {
	const cookieStore = await cookies();
	return cookieStore.get(GUEST_COOKIE)?.value ?? null;
}

export async function ensureGuestId(): Promise<string> {
	const cookieStore = await cookies();
	const existing = cookieStore.get(GUEST_COOKIE)?.value;
	if (existing) return existing;
	const id = randomId();
	cookieStore.set(GUEST_COOKIE, id, {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 30,
	});
	return id;
}

export async function getGuestProject(): Promise<GuestProject | null> {
	const id = await getGuestId();
	if (!id) return null;
	return store().get(id)?.project ?? null;
}

export async function saveGuestProject(input: {
	websiteUrl: string;
	name: string;
	industry?: string | null;
}): Promise<GuestProject> {
	const id = await ensureGuestId();
	const current = store().get(id) ?? {};
	const project: GuestProject = {
		id: "guest",
		name: input.name,
		website_url: input.websiteUrl,
		industry: input.industry ?? null,
	};
	store().set(id, { ...current, project });
	return project;
}

export async function getGuestAudit(): Promise<GuestAudit | null> {
	const id = await getGuestId();
	if (!id) return null;
	return store().get(id)?.audit ?? null;
}

export async function saveGuestAudit(result: AuditResult): Promise<GuestAudit> {
	const id = await ensureGuestId();
	const current = store().get(id) ?? {};
	const audit: GuestAudit = {
		id: "guest",
		score: result.score,
		created_at: result.fetchedAt,
		summary: { ...result.stats, dimensions: result.dimensions },
		findings: result.findings,
		pages: result.pages,
		pageAi: {},
	};
	store().set(id, { ...current, audit });
	return audit;
}

export async function getGuestPages(): Promise<AuditPageRecord[]> {
	return (await getGuestAudit())?.pages ?? [];
}

export async function getGuestPageById(
	pageId: string,
): Promise<{ record: AuditPageRecord; ai: PageAiAnalysis | null } | null> {
	const audit = await getGuestAudit();
	if (!audit) return null;
	const record = audit.pages.find(p => guestPageId(p.url) === pageId);
	if (!record) return null;
	return { record, ai: audit.pageAi[pageId] ?? null };
}

export async function saveGuestPageAi(pageId: string, ai: PageAiAnalysis): Promise<void> {
	const id = await getGuestId();
	if (!id) return;
	const current = store().get(id);
	if (!current?.audit) return;
	current.audit.pageAi = { ...current.audit.pageAi, [pageId]: ai };
	store().set(id, current);
}

// --- Page Gap Analyzer (guest) ---------------------------------------------

export async function saveGuestPageGapRun(report: PageGapResult): Promise<string> {
	const id = await ensureGuestId();
	const current = store().get(id) ?? {};
	const runId = randomId();
	const run: GuestPageGapRun = {
		id: runId,
		report,
		llm: null,
		llmStatus: "pending",
		schema: null,
		schemaStatus: "pending",
		created_at: report.fetchedAt,
	};
	store().set(id, {
		...current,
		pageGapRuns: { ...(current.pageGapRuns ?? {}), [runId]: run },
	});
	return runId;
}

export async function listGuestPageGapRuns(): Promise<GuestPageGapRun[]> {
	const id = await getGuestId();
	if (!id) return [];
	const runs = store().get(id)?.pageGapRuns ?? {};
	return Object.values(runs).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getGuestPageGapRun(runId: string): Promise<GuestPageGapRun | null> {
	const id = await getGuestId();
	if (!id) return null;
	return store().get(id)?.pageGapRuns?.[runId] ?? null;
}

export async function setGuestPageGapLlmStatus(runId: string, status: GuestLlmStatus, error?: string): Promise<void> {
	const id = await getGuestId();
	if (!id) return;
	const current = store().get(id);
	const run = current?.pageGapRuns?.[runId];
	if (!current || !run) return;
	run.llmStatus = status;
	run.llmError = error ?? null;
	store().set(id, current);
}

export async function saveGuestPageGapLlm(runId: string, llm: PageGapLlm): Promise<void> {
	const id = await getGuestId();
	if (!id) return;
	const current = store().get(id);
	const run = current?.pageGapRuns?.[runId];
	if (!current || !run) return;
	run.llm = llm;
	run.llmStatus = "done";
	run.llmError = null;
	store().set(id, current);
}

/** Persist partial AI output mid-run without flipping the status to "done". */
export async function updateGuestPageGapLlmProgress(runId: string, llm: PageGapLlm): Promise<void> {
	const id = await getGuestId();
	if (!id) return;
	const current = store().get(id);
	const run = current?.pageGapRuns?.[runId];
	if (!current || !run) return;
	run.llm = llm;
	run.llmStatus = "running";
	run.llmError = null;
	store().set(id, current);
}

export async function setGuestPageGapSchemaStatus(
	runId: string,
	status: GuestLlmStatus,
	error?: string,
): Promise<void> {
	const id = await getGuestId();
	if (!id) return;
	const current = store().get(id);
	const run = current?.pageGapRuns?.[runId];
	if (!current || !run) return;
	run.schemaStatus = status;
	run.schemaError = error ?? null;
	store().set(id, current);
}

export async function saveGuestPageGapSchema(runId: string, schema: SchemaResult): Promise<void> {
	const id = await getGuestId();
	if (!id) return;
	const current = store().get(id);
	const run = current?.pageGapRuns?.[runId];
	if (!current || !run) return;
	run.schema = schema;
	run.schemaStatus = "done";
	run.schemaError = null;
	store().set(id, current);
}
