"use client";

import { useState } from "react";
import type { Gap, GapDimension } from "@/lib/page-gap-engine";
import { Md } from "./Markdown";

const SEV_STYLE: Record<string, string> = {
	critical: "text-[var(--color-danger)] border-[var(--color-danger)]/40",
	high: "text-[#fb923c] border-[#fb923c]/40",
	medium: "text-[var(--color-warning)] border-[var(--color-warning)]/40",
	low: "text-[var(--color-accent)] border-[var(--color-accent)]/40",
	pass: "text-[var(--color-success)] border-[var(--color-success)]/40",
};

const DIM_LABEL: Record<GapDimension, string> = {
	intent_match: "Intent",
	onpage_seo: "On-page SEO",
	content_quality: "Content",
	eeat: "E-E-A-T",
	conversion: "Conversion",
	internal_linking: "Internal Links",
	structured_data: "Schema",
	geo_readiness: "GEO",
};

const SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;
const VALIDATED = [
	{ key: "all", label: "All" },
	{ key: "yes", label: "SERP-validated" },
	{ key: "no", label: "Best practice" },
] as const;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			onClick={onClick}
			className={`rounded-full border px-3 py-1 text-xs transition-colors ${
				active
					? "border-[var(--color-brand)] bg-[var(--color-surface-2)] text-[var(--color-fg)]"
					: "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
			}`}
		>
			{children}
		</button>
	);
}

export function GapFindings({ gaps }: { gaps: Gap[] }) {
	const [sev, setSev] = useState<(typeof SEVERITIES)[number]>("all");
	const [dim, setDim] = useState<GapDimension | "all">("all");
	const [validated, setValidated] = useState<(typeof VALIDATED)[number]["key"]>("all");

	const dims = Array.from(new Set(gaps.map(g => g.dimension)));

	const filtered = gaps.filter(g => {
		if (sev !== "all" && g.severity !== sev) return false;
		if (dim !== "all" && g.dimension !== dim) return false;
		if (validated === "yes" && !g.serp_validated) return false;
		if (validated === "no" && g.serp_validated) return false;
		return true;
	});

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-[var(--color-muted)] w-16">Severity</span>
					{SEVERITIES.map(s => (
						<Chip key={s} active={sev === s} onClick={() => setSev(s)}>
							{s}
						</Chip>
					))}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-[var(--color-muted)] w-16">Dimension</span>
					<Chip active={dim === "all"} onClick={() => setDim("all")}>
						all
					</Chip>
					{dims.map(d => (
						<Chip key={d} active={dim === d} onClick={() => setDim(d)}>
							{DIM_LABEL[d]}
						</Chip>
					))}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-[var(--color-muted)] w-16">Evidence</span>
					{VALIDATED.map(v => (
						<Chip key={v.key} active={validated === v.key} onClick={() => setValidated(v.key)}>
							{v.label}
						</Chip>
					))}
				</div>
			</div>

			{filtered.length === 0 ? (
				<p className="text-sm text-[var(--color-muted)]">No findings match the filter.</p>
			) : (
				<div className="space-y-3">
					{filtered.map(g => (
						<details key={g.id} className="card p-4" open={g.severity === "critical"}>
							<summary className="flex cursor-pointer flex-wrap items-center gap-2">
								<span
									className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${SEV_STYLE[g.severity]}`}
								>
									{g.severity}
								</span>
								<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
									{DIM_LABEL[g.dimension]}
								</span>
								<span className="font-medium">{g.title}</span>
								<span
									className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] ${
										g.serp_validated
											? "border-[var(--color-success)]/40 text-[var(--color-success)]"
											: "border-[var(--color-border)] text-[var(--color-muted)]"
									}`}
								>
									{g.serp_prevalence}
								</span>
							</summary>

							<div className="mt-3 space-y-2 text-sm">
								<p className="text-[var(--color-muted)]">
									<span className="font-medium text-[var(--color-fg)]">Why it matters: </span>
									{g.why_it_matters}
								</p>
								<p className="text-[var(--color-muted)]">
									<span className="font-medium" style={{ color: "var(--color-success)" }}>
										Action:{" "}
									</span>
									{g.recommended_action}
								</p>
								{g.suggested_fix && (
									<div className="rounded-md border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-2.5 text-[var(--color-muted)]">
										<span className="font-medium text-[var(--color-accent)]">✦ AI fix: </span>
										<Md>{g.suggested_fix}</Md>
									</div>
								)}
								{!g.serp_validated && (
									<p className="text-[10px] uppercase tracking-wide text-[var(--color-warning)]">
										Best practice — not validated in this SERP
									</p>
								)}
								{g.serp_evidence.length > 0 && (
									<div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
										<div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
											SERP evidence
										</div>
										<ul className="space-y-1">
											{g.serp_evidence.map((e, i) => (
												<li key={i} className="text-xs">
													<span className="text-[var(--color-accent)]">
														#{e.rank} {e.domain}
													</span>
													<span className="text-[var(--color-muted)]"> — {e.example_value}</span>
												</li>
											))}
										</ul>
									</div>
								)}
							</div>
						</details>
					))}
				</div>
			)}
		</div>
	);
}
