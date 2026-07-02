/**
 * Shared micro-agent runner.
 *
 * Every AI call in the app goes through one narrow contract: a focused prompt,
 * a strict parser, and a validator. The runner is what makes small models
 * reliable — instead of hoping one big generation comes back well-formed, each
 * agent's output is parsed and validated, and a failed attempt is retried ONCE
 * with corrective feedback naming exactly what was malformed or missing. If the
 * retry still fails, the best partially-valid attempt (fewest problems) is kept
 * so callers can deterministically backfill the gaps rather than lose the run.
 *
 * Design goals (per the accuracy overhaul):
 * - Use AI as little as possible: callers gate agents behind deterministic
 *   checks and skip the call entirely when logic can produce the answer.
 * - When AI IS used, never trust it blindly: parse → validate → retry →
 *   deterministic fallback, in that order.
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { generateText } from "@/lib/ai";

// ---------------------------------------------------------------------------
// Agent activity events — the live wire behind every progress UI.
//
// runAgent reports what it is doing (generating / retrying-with-reason / done /
// failed) into an AsyncLocalStorage channel. Routes wrap pipeline calls in
// withAgentEvents() and forward the events over their NDJSON stream, so the
// user sees the actual activity ("meta-writer: retrying — TITLE was 78 chars")
// instead of an anonymous spinner. Pipelines can also emit their own
// deterministic-phase notes via emitAgentEvent().
// ---------------------------------------------------------------------------

export type AgentEvent = {
	/** Agent (or "pipeline" for deterministic phases). */
	agent: string;
	phase: "generating" | "retrying" | "done" | "failed" | "note";
	/** 1-based attempt number (0 for pipeline notes). */
	attempt: number;
	/** Human-readable specifics (retry reason, note text). */
	detail?: string;
};

const agentEventStore = new AsyncLocalStorage<(e: AgentEvent) => void>();

/** Run `fn` with agent events forwarded to `onEvent` (listener errors are swallowed). */
export function withAgentEvents<T>(onEvent: (e: AgentEvent) => void, fn: () => Promise<T>): Promise<T> {
	const safe = (e: AgentEvent) => {
		try {
			onEvent(e);
		} catch {
			/* progress reporting must never break the run */
		}
	};
	return agentEventStore.run(safe, fn);
}

/** Emit an event to the ambient listener, if any (no-op outside withAgentEvents). */
export function emitAgentEvent(e: AgentEvent): void {
	agentEventStore.getStore()?.(e);
}

export type AgentSpec<T> = {
	/** Short agent name, used in warnings/telemetry (e.g. "meta-writer"). */
	name: string;
	system: string;
	prompt: string;
	maxTokens?: number;
	timeoutMs?: number;
	/** Parse the raw model output into the agent's typed result. Null = unusable. */
	parse: (raw: string) => T | null;
	/**
	 * Check the parsed value. Return [] when acceptable; otherwise a list of
	 * SPECIFIC problems — each one is fed back to the model verbatim on retry,
	 * so write them as instructions ("GAP_FIXES is missing ids: a, b").
	 */
	validate?: (value: T) => string[];
	/** Extra attempts after the first (default 1). */
	retries?: number;
};

export type AgentOutcome<T> =
	| {
			ok: true;
			value: T;
			attempts: number;
			/** Residual validation problems on the accepted attempt (callers backfill these deterministically). */
			problems: string[];
	  }
	| { ok: false; value: null; attempts: number; problems: string[] };

function correctivePrompt(basePrompt: string, problems: string[]): string {
	return `${basePrompt}

IMPORTANT — YOUR PREVIOUS RESPONSE WAS REJECTED for the following reasons:
${problems.map(p => `- ${p}`).join("\n")}
Produce the response again from scratch, fixing EVERY listed problem. Follow the required output format EXACTLY, with no text outside it.`;
}

/**
 * Run one micro-agent: generate → parse → validate → (retry with corrective
 * feedback) → best-effort accept. Never throws on model/format failure — only
 * generateText's own "no model connected" error propagates, so callers can
 * distinguish "no AI configured" from "AI answered badly".
 */
export async function runAgent<T>(spec: AgentSpec<T>): Promise<AgentOutcome<T>> {
	const retries = spec.retries ?? 1;
	let lastProblems: string[] = [];
	let best: { value: T; problems: string[] } | null = null;

	for (let attempt = 1; attempt <= retries + 1; attempt++) {
		const prompt = attempt === 1 ? spec.prompt : correctivePrompt(spec.prompt, lastProblems);
		emitAgentEvent(
			attempt === 1
				? { agent: spec.name, phase: "generating", attempt }
				: { agent: spec.name, phase: "retrying", attempt, detail: lastProblems[0] },
		);

		let raw = "";
		try {
			raw = await generateText({
				system: spec.system,
				prompt,
				maxTokens: spec.maxTokens,
				timeoutMs: spec.timeoutMs,
			});
		} catch (e) {
			const msg = (e as Error).message || "request failed";
			// "No AI model is connected" is a configuration problem, not a bad
			// generation — retrying can't help and callers handle it specially.
			if (/no ai model/i.test(msg)) throw e;
			lastProblems = [`The request failed: ${msg}`];
			continue;
		}

		const value = spec.parse(raw);
		if (value === null) {
			lastProblems = [
				"The output could not be parsed — the required delimited sections / JSON object were missing or malformed.",
			];
			continue;
		}

		const problems = spec.validate?.(value) ?? [];
		if (problems.length === 0) {
			emitAgentEvent({ agent: spec.name, phase: "done", attempt });
			return { ok: true, value, attempts: attempt, problems: [] };
		}

		if (!best || problems.length < best.problems.length) best = { value, problems };
		lastProblems = problems;
	}

	// Accept the best partially-valid attempt so a near-miss isn't thrown away —
	// the residual problems tell the caller exactly what to backfill.
	if (best) {
		emitAgentEvent({ agent: spec.name, phase: "done", attempt: retries + 1, detail: "accepted with fallbacks" });
		return { ok: true, value: best.value, attempts: retries + 1, problems: best.problems };
	}
	emitAgentEvent({ agent: spec.name, phase: "failed", attempt: retries + 1, detail: lastProblems[0] });
	return { ok: false, value: null, attempts: retries + 1, problems: lastProblems };
}
