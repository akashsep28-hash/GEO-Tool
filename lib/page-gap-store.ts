/**
 * Actor-aware persistence for Page Gap Analyzer runs.
 * Authenticated users -> Supabase `page_gap_runs`. Guests -> cookie-keyed
 * in-memory store (lib/guest-session.ts). Mirrors lib/audit-pages.ts.
 */
import "server-only";
import { getActor } from "@/lib/actor";
import {
	type GuestLlmStatus,
	getGuestPageGapRun,
	listGuestPageGapRuns,
	saveGuestPageGapLlm,
	saveGuestPageGapRun,
	saveGuestPageGapSchema,
	setGuestPageGapLlmStatus,
	setGuestPageGapSchemaStatus,
	updateGuestPageGapLlmProgress,
} from "@/lib/guest-session";
import type { PageGapLlm } from "@/lib/page-gap-llm";
import type { PageGapResult } from "@/lib/page-gap-run";
import type { SchemaResult } from "@/lib/page-gap-schema";
import { createClient } from "@/lib/supabase/server";

export type LlmStatus = GuestLlmStatus;

export type PageGapRunListItem = {
	id: string;
	keyword: string;
	targetUrl: string;
	score: number | null;
	verdict: string | null;
	mismatch: boolean | null;
	createdAt: string;
	llmStatus: LlmStatus;
};

export type StoredPageGapRun = {
	id: string;
	report: PageGapResult;
	llm: PageGapLlm | null;
	llmStatus: LlmStatus;
	llmError?: string | null;
	schema: SchemaResult | null;
	schemaStatus: LlmStatus;
	schemaError?: string | null;
	createdAt: string;
};

/** Persist a finished deterministic run. Returns the new run id. */
export async function savePageGapRun(report: PageGapResult): Promise<string> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		return saveGuestPageGapRun(report);
	}

	const supabase = await createClient();
	const { data: project } = await supabase.from("projects").select("id").eq("is_primary", true).maybeSingle();

	const { data, error } = await supabase
		.from("page_gap_runs")
		.insert({
			user_id: actor.id,
			project_id: project?.id ?? null,
			keyword: report.keyword,
			target_url: report.targetUrl,
			country: report.country,
			device: report.device,
			score: report.score,
			verdict: report.intent.verdict,
			mismatch: report.intent.mismatch,
			report,
			llm_status: "pending",
		})
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}

export async function listPageGapRuns(): Promise<PageGapRunListItem[]> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		const runs = await listGuestPageGapRuns();
		return runs.map(r => ({
			id: r.id,
			keyword: r.report.keyword,
			targetUrl: r.report.targetUrl,
			score: r.report.score,
			verdict: r.report.intent.verdict,
			mismatch: r.report.intent.mismatch,
			createdAt: r.created_at,
			llmStatus: r.llmStatus,
		}));
	}

	const supabase = await createClient();
	const { data } = await supabase
		.from("page_gap_runs")
		.select("id, keyword, target_url, score, verdict, mismatch, created_at, llm_status")
		.order("created_at", { ascending: false })
		.limit(25);
	return (data ?? []).map(r => ({
		id: r.id,
		keyword: r.keyword,
		targetUrl: r.target_url,
		score: r.score,
		verdict: r.verdict,
		mismatch: r.mismatch,
		createdAt: r.created_at,
		llmStatus: (r.llm_status as LlmStatus) ?? "pending",
	}));
}

export async function getPageGapRun(runId: string): Promise<StoredPageGapRun | null> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		const run = await getGuestPageGapRun(runId);
		if (!run) return null;
		return {
			id: run.id,
			report: run.report,
			llm: run.llm,
			llmStatus: run.llmStatus,
			llmError: run.llmError,
			schema: run.schema ?? null,
			schemaStatus: run.schemaStatus ?? "pending",
			schemaError: run.schemaError,
			createdAt: run.created_at,
		};
	}

	const supabase = await createClient();
	const { data } = await supabase
		.from("page_gap_runs")
		.select("id, report, llm_analysis, llm_status, llm_error, schema_jsonld, schema_status, schema_error, created_at")
		.eq("id", runId)
		.maybeSingle();
	if (!data) return null;
	return {
		id: data.id,
		report: data.report as PageGapResult,
		llm: (data.llm_analysis as PageGapLlm | null) ?? null,
		llmStatus: (data.llm_status as LlmStatus) ?? "pending",
		llmError: data.llm_error ?? null,
		schema: (data.schema_jsonld as SchemaResult | null) ?? null,
		schemaStatus: (data.schema_status as LlmStatus) ?? "pending",
		schemaError: data.schema_error ?? null,
		createdAt: data.created_at,
	};
}

export async function setPageGapLlmStatus(runId: string, status: LlmStatus, error?: string): Promise<void> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		await setGuestPageGapLlmStatus(runId, status, error);
		return;
	}
	const supabase = await createClient();
	await supabase
		.from("page_gap_runs")
		.update({ llm_status: status, llm_error: error ?? null })
		.eq("id", runId);
}

/**
 * Persist partial AI output mid-sequence, keeping status "running". The
 * streaming analyze route calls this after each section so a refresh shows the
 * partial report; savePageGapLlm is the final call that flips status to "done".
 */
export async function updatePageGapLlmProgress(runId: string, llm: PageGapLlm): Promise<void> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		await updateGuestPageGapLlmProgress(runId, llm);
		return;
	}
	const supabase = await createClient();
	await supabase
		.from("page_gap_runs")
		.update({ llm_analysis: llm, llm_status: "running", llm_model: llm.model, llm_error: null })
		.eq("id", runId);
}

export async function savePageGapLlm(runId: string, llm: PageGapLlm): Promise<void> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		await saveGuestPageGapLlm(runId, llm);
		return;
	}
	const supabase = await createClient();
	await supabase
		.from("page_gap_runs")
		.update({
			llm_analysis: llm,
			llm_status: "done",
			llm_model: llm.model,
			llm_error: null,
		})
		.eq("id", runId);
}

export async function setPageGapSchemaStatus(runId: string, status: LlmStatus, error?: string): Promise<void> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		await setGuestPageGapSchemaStatus(runId, status, error);
		return;
	}
	const supabase = await createClient();
	await supabase
		.from("page_gap_runs")
		.update({ schema_status: status, schema_error: error ?? null })
		.eq("id", runId);
}

export async function savePageGapSchema(runId: string, schema: SchemaResult): Promise<void> {
	const actor = await getActor();
	if (actor.kind === "guest") {
		await saveGuestPageGapSchema(runId, schema);
		return;
	}
	const supabase = await createClient();
	await supabase
		.from("page_gap_runs")
		.update({
			schema_jsonld: schema,
			schema_status: "done",
			schema_model: schema.model,
			schema_error: null,
		})
		.eq("id", runId);
}
