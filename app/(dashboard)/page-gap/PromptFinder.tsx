"use client";

import { useState } from "react";
import type { PromptFinderResult, PromptIntent } from "@/lib/prompt-finder";
import { Md } from "./Markdown";

const INTENT_LABEL: Record<PromptIntent, string> = {
	informational: "Informational",
	comparison: "Comparison",
	commercial: "Commercial",
	transactional: "Transactional",
	local: "Local",
};

const INTENT_COLOR: Record<PromptIntent, string> = {
	informational: "#a78bfa",
	comparison: "#fbbf24",
	commercial: "#60a5fa",
	transactional: "#34d399",
	local: "#f472b6",
};

const READINESS_STYLE: Record<string, string> = {
	ready: "border-[var(--color-success)]/40 text-[var(--color-success)]",
	partial: "border-[var(--color-warning)]/40 text-[var(--color-warning)]",
	missing: "border-[var(--color-danger)]/40 text-[var(--color-danger)]",
};

const PRIORITY_STYLE: Record<string, string> = {
	critical: "text-[var(--color-danger)] border-[var(--color-danger)]/40",
	high: "text-[#fb923c] border-[#fb923c]/40",
	medium: "text-[var(--color-warning)] border-[var(--color-warning)]/40",
	low: "text-[var(--color-accent)] border-[var(--color-accent)]/40",
};

function Chip({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
			<div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
			<div className="mt-0.5 text-sm font-medium">{value}</div>
		</div>
	);
}

export function PromptFinder({ data }: { data: PromptFinderResult }) {
	const intents = Array.from(new Set(data.prompts.map(p => p.intent)));
	const [intent, setIntent] = useState<PromptIntent | "all">("all");
	const [onlyGaps, setOnlyGaps] = useState(false);

	const prompts = data.prompts.filter(p => {
		if (intent !== "all" && p.intent !== intent) return false;
		if (onlyGaps && p.readiness === "ready") return false;
		return true;
	});

	return (
		<div className="space-y-5">
			{/* Classification */}
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				<Chip label={`Industry · ${data.industryConfidence}% conf`} value={data.industry} />
				<Chip label="Niche" value={data.niche} />
				<Chip label="Topic" value={data.topic} />
				<Chip label="Primary intent" value={data.primaryIntent} />
				<Chip label="Audience" value={data.audience} />
				<Chip
					label="Source"
					value={`${data.source === "ai" ? `AI (${data.model ?? "model"})` : "Deterministic"}${data.isYmyl ? " · YMYL" : ""}`}
				/>
			</div>
			<p className="text-xs text-[var(--color-muted)]">{data.relevanceNotes}</p>

			{/* Prompts */}
			<div className="space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-[var(--color-muted)]">Prompts to align this page to</span>
					<button
						onClick={() => setIntent("all")}
						className={`rounded-full border px-3 py-1 text-xs ${intent === "all" ? "border-[var(--color-brand)] bg-[var(--color-surface-2)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
					>
						all
					</button>
					{intents.map(it => (
						<button
							key={it}
							onClick={() => setIntent(it)}
							className={`rounded-full border px-3 py-1 text-xs ${intent === it ? "border-[var(--color-brand)] bg-[var(--color-surface-2)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
						>
							{INTENT_LABEL[it]}
						</button>
					))}
					<label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
						<input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} />
						Only prompts needing work
					</label>
				</div>

				<div className="space-y-2.5">
					{prompts.map((p, idx) => (
						<div key={idx} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3.5">
							<div className="flex flex-wrap items-start gap-2">
								<span
									className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide"
									style={{ borderColor: `${INTENT_COLOR[p.intent]}66`, color: INTENT_COLOR[p.intent] }}
								>
									{INTENT_LABEL[p.intent]}
								</span>
								<span className="font-medium">“{p.prompt}”</span>
								<span
									className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${READINESS_STYLE[p.readiness]}`}
								>
									{p.readiness}
								</span>
							</div>
							{p.rationale && (
								<p className="mt-1.5 text-xs text-[var(--color-muted)]">
									<Md>{p.rationale}</Md>
								</p>
							)}
							<div className="mt-1.5 flex flex-wrap gap-1.5">
								{p.platforms.map(pl => (
									<span
										key={pl}
										className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
									>
										{pl}
									</span>
								))}
							</div>
							{p.alignmentActions.length > 0 && (
								<ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--color-muted)]">
									{p.alignmentActions.map((a, i) => (
										<li key={i}>
											<Md>{a}</Md>
										</li>
									))}
								</ul>
							)}
						</div>
					))}
					{prompts.length === 0 && (
						<p className="text-sm text-[var(--color-muted)]">No prompts match the filter.</p>
					)}
				</div>
			</div>

			{/* GEO optimization items */}
			{data.geoOptimizationItems.length > 0 && (
				<div className="space-y-2 border-t border-[var(--color-border)] pt-4">
					<h3 className="text-sm font-semibold">GEO items to update (mapped to the prompts they unlock)</h3>
					<div className="space-y-2">
						{data.geoOptimizationItems.map((it, idx) => (
							<div key={idx} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
								<div className="flex flex-wrap items-center gap-2">
									<span
										className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${PRIORITY_STYLE[it.priority]}`}
									>
										{it.priority}
									</span>
									<span className="font-medium">
										<Md>{it.item}</Md>
									</span>
								</div>
								{it.why && (
									<p className="mt-1 text-xs text-[var(--color-muted)]">
										<Md>{it.why}</Md>
									</p>
								)}
								{it.prompts.length > 0 && (
									<p className="mt-1 text-[11px] text-[var(--color-muted)]">
										Unlocks: {it.prompts.map(q => `“${q}”`).join(", ")}
									</p>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
