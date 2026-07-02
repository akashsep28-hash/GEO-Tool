"use client";

/**
 * Shared live-activity kit for every long-running action.
 *
 * The server pipelines stream NDJSON events (section progress + per-agent
 * activity from lib/agent-runner.ts). These helpers turn that stream into an
 * informative UI: what exactly is happening right now, what already finished,
 * how long it has been running — instead of an anonymous spinner.
 */

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// NDJSON stream reader.
// ---------------------------------------------------------------------------

export type StreamEvent = {
	type: string;
	// section progress
	step?: number;
	total?: number;
	label?: string;
	pct?: number;
	current?: number;
	// agent activity
	agent?: string;
	phase?: "generating" | "retrying" | "done" | "failed" | "note";
	attempt?: number;
	detail?: string;
	// terminal
	runId?: string;
	error?: string;
	result?: unknown;
	partialErrors?: string[];
};

/** POST (or GET) an NDJSON endpoint and invoke onEvent per parsed line. */
export async function readNdjson(input: string, init: RequestInit, onEvent: (ev: StreamEvent) => void): Promise<void> {
	const res = await fetch(input, init);
	if (!res.ok || !res.body) throw new Error(`Request failed (${res.status}).`);
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			let ev: StreamEvent;
			try {
				ev = JSON.parse(line) as StreamEvent;
			} catch {
				continue; // malformed line — but an onEvent throw must propagate
			}
			onEvent(ev);
		}
	}
	if (buffer.trim()) {
		let ev: StreamEvent | null = null;
		try {
			ev = JSON.parse(buffer) as StreamEvent;
		} catch {
			ev = null;
		}
		if (ev) onEvent(ev);
	}
}

// ---------------------------------------------------------------------------
// Agent-event → human description.
// ---------------------------------------------------------------------------

const AGENT_LABEL: Record<string, string> = {
	"content-assessor": "Judging content quality",
	"meta-writer": "Writing title & meta description",
	"intro-writer": "Writing the answer-first intro",
	"faq-drafter": "Drafting FAQ from the page's own text",
	"schema-extraction": "Extracting page facts for schema",
	"schema-audit": "Fact-checking existing schema against the page",
	"content-drafter": "Drafting grounded answers",
	"competitor-analysis": "Analysing ranking patterns",
	"intent-narrative": "Explaining the intent verdict",
	"page-gap-analysis": "Writing findings, fixes & the action plan",
	"prompt-finder": "Refining the GEO prompt bank",
	"heading-blueprint": "Designing the heading blueprint",
};

const trim = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One-line description of an agent event ("" = not display-worthy). */
export function describeActivity(ev: StreamEvent): string {
	if (ev.agent === "pipeline") return ev.detail ?? "";
	const who = AGENT_LABEL[ev.agent ?? ""] ?? ev.agent ?? "";
	if (!who) return "";
	switch (ev.phase) {
		case "generating":
			return `${who} (asking the model)…`;
		case "retrying":
			return `${who} — answer rejected, retrying${ev.detail ? `: ${trim(ev.detail)}` : "…"}`;
		case "done":
			return `${who} ✓${ev.detail ? ` (${ev.detail})` : ""}`;
		case "failed":
			return `${who} ✗ — using the deterministic fallback`;
		default:
			return who;
	}
}

// ---------------------------------------------------------------------------
// UI pieces.
// ---------------------------------------------------------------------------

export function Spinner() {
	return (
		<svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
			<path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
		</svg>
	);
}

/** Seconds elapsed since `since` (ms epoch), ticking every second. */
export function useElapsed(since: number | null): string {
	const [, force] = useState(0);
	useEffect(() => {
		if (since === null) return;
		const t = setInterval(() => force(x => x + 1), 1000);
		return () => clearInterval(t);
	}, [since]);
	if (since === null) return "";
	const s = Math.max(0, Math.round((Date.now() - since) / 1000));
	return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export type ActivityState = {
	/** Headline: the stage/section being worked (e.g. "3/5 · Page Gap Analysis"). */
	headline: string;
	/** Current fine-grained activity (from agent events). */
	now: string;
	/** Completed activity lines, newest last. */
	log: string[];
	startedAt: number;
};

export function emptyActivity(headline: string): ActivityState {
	return { headline, now: "", log: [], startedAt: Date.now() };
}

/** Fold a stream event into the activity state (returns a new state). */
export function foldActivity(a: ActivityState, ev: StreamEvent): ActivityState {
	if (ev.type === "progress" && ev.label) {
		const headline = ev.step && ev.total ? `${ev.step}/${ev.total} · ${ev.label}` : ev.label;
		return { ...a, headline, now: "" };
	}
	if (ev.type === "activity") {
		const line = describeActivity(ev);
		if (!line) return a;
		// Completed/failed agents move to the log; in-flight text becomes "now".
		if (ev.phase === "done" || ev.phase === "failed") {
			return { ...a, now: "", log: [...a.log.slice(-5), line] };
		}
		return { ...a, now: line };
	}
	return a;
}

/**
 * The live panel: headline + current activity + recent finished steps + timer.
 * Drop-in under any button while its stream runs.
 */
export function ActivityPanel({ activity, className = "" }: { activity: ActivityState; className?: string }) {
	const elapsed = useElapsed(activity.startedAt);
	return (
		<div className={`space-y-1 text-left ${className}`} role="status" aria-live="polite">
			<div className="flex items-center gap-2 text-xs text-[var(--color-fg)]">
				<Spinner />
				<span className="font-medium">{activity.headline}</span>
				<span className="ml-auto tabular-nums text-[var(--color-muted)]">{elapsed}</span>
			</div>
			{activity.now && <div className="pl-6 text-[11px] text-[var(--color-brand)]">{activity.now}</div>}
			{activity.log.length > 0 && (
				<ul className="space-y-0.5 pl-6">
					{activity.log.slice(-4).map(line => (
						<li key={line} className="text-[11px] text-[var(--color-muted)]">
							{line}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
