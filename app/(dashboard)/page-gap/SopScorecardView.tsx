import type { SopCategoryScore, SopItemResult, SopScorecard, SopStatus } from "@/lib/page-gap-sop";

const STATUS_META: Record<SopStatus, { label: string; chip: string }> = {
	pass: { label: "Pass", chip: "#34d399" },
	partial: { label: "Partial", chip: "#fbbf24" },
	fail: { label: "Fail", chip: "#f87171" },
	unknown: { label: "No data", chip: "#9ca3af" },
	not_applicable: { label: "N/A", chip: "#6b7280" },
};

function scoreColor(score: number): string {
	return score >= 75 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
}

/** Issues first (fail before partial), then highest SOP weight (impact) first. */
function byActionability(a: SopItemResult, b: SopItemResult): number {
	const rank = (s: SopStatus) => (s === "fail" ? 0 : s === "partial" ? 1 : 2);
	return rank(a.status) - rank(b.status) || b.weight - a.weight;
}

function StatusChip({ status }: { status: SopStatus }) {
	const m = STATUS_META[status];
	return (
		<span
			className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
			style={{ color: m.chip, border: `1px solid ${m.chip}55`, backgroundColor: `${m.chip}12` }}
		>
			{m.label}
		</span>
	);
}

/** A failing/partial item — the actionable finding the user fixes. */
function FindingCard({ item }: { item: SopItemResult }) {
	const prevalence = item.serpPrevalence;
	return (
		<div className="border-t border-[var(--color-border)] px-4 py-3 first:border-t-0">
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-start gap-2">
					<StatusChip status={item.status} />
					<div>
						<div className="text-sm font-medium">{item.title}</div>
						<div className="mt-0.5 text-xs text-[var(--color-muted)]">{item.detail}</div>
					</div>
				</div>
				<div className="shrink-0 text-right">
					<div className="text-[10px] font-semibold" style={{ color: scoreColor(100 - item.weight * 12) }}>
						impact {item.weight}
					</div>
					<div className="font-mono text-[10px] text-[var(--color-muted)]">
						SOP r{item.sopRow} · {item.sopSource}
					</div>
				</div>
			</div>

			<div className="mt-1.5 pl-1 text-xs text-[var(--color-accent)]">→ {item.recommendation}</div>

			{(prevalence || item.evidence.length > 0) && (
				<div className="mt-2 flex flex-wrap items-center gap-2 pl-1">
					{prevalence && (
						<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]">
							{prevalence.pass}/{prevalence.total} ranking pages pass this
						</span>
					)}
					{item.evidence.slice(0, 3).map((e, idx) => (
						<span
							key={idx}
							className="max-w-[280px] truncate rounded border border-[var(--color-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-muted)]"
							title={e}
						>
							{e}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

/** A compact one-line confirmation for items that don't need work. */
function CompactRow({ item }: { item: SopItemResult }) {
	const m = STATUS_META[item.status];
	return (
		<span
			className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] px-2 py-1 text-[11px]"
			title={item.detail}
		>
			<span style={{ color: m.chip }}>{item.status === "pass" ? "✓" : "·"}</span>
			<span className="text-[var(--color-muted)]">{item.title}</span>
		</span>
	);
}

function CategoryPanel({ cat }: { cat: SopCategoryScore }) {
	const color = scoreColor(cat.score);
	const issues = cat.items.filter(i => i.status === "fail" || i.status === "partial").sort(byActionability);
	const passing = cat.items.filter(i => i.status === "pass");
	const other = cat.items.filter(i => i.status === "unknown" || i.status === "not_applicable");

	return (
		<div className="overflow-hidden rounded-md border border-[var(--color-border)]">
			<div className="flex items-center justify-between gap-3 bg-[var(--color-surface-2)] px-4 py-2.5">
				<div className="flex items-center gap-2 text-sm font-semibold">
					{cat.label}
					{issues.length > 0 ? (
						<span className="rounded-full bg-[var(--color-danger)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-danger)]">
							{issues.length} to fix
						</span>
					) : (
						<span className="rounded-full bg-[var(--color-success)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-success)]">
							all clear
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-[var(--color-muted)]">scored weight {cat.scoredWeight}</span>
					<span className="text-lg font-bold" style={{ color }}>
						{cat.score}
						<span className="text-xs font-normal text-[var(--color-muted)]">/100</span>
					</span>
				</div>
			</div>

			{issues.length > 0 && (
				<div>
					{issues.map(it => (
						<FindingCard key={it.id} item={it} />
					))}
				</div>
			)}

			{(passing.length > 0 || other.length > 0) && (
				<div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
					{passing.map(it => (
						<CompactRow key={it.id} item={it} />
					))}
					{other.map(it => (
						<CompactRow key={it.id} item={it} />
					))}
				</div>
			)}
		</div>
	);
}

export function SopScorecardView({ scorecard }: { scorecard: SopScorecard }) {
	const { dataSources } = scorecard;
	const totalIssues = scorecard.categories.reduce(
		(n, c) => n + c.items.filter(i => i.status === "fail" || i.status === "partial").length,
		0,
	);
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3 text-[10px] text-[var(--color-muted)]">
				<span className="font-medium text-[var(--color-fg)]">{totalIssues} action items to fix</span>
				<span>· deterministic — same URL + keyword always yields this result</span>
				<span className="rounded border border-[var(--color-border)] px-2 py-0.5">
					PageSpeed: {dataSources.psiField ? "CrUX field data" : dataSources.psi ? "lab only" : "unavailable"}
				</span>
				<span className="rounded border border-[var(--color-border)] px-2 py-0.5">
					Site signals: {dataSources.site ? "fetched" : "unavailable"}
				</span>
			</div>
			{scorecard.categories.map(cat => (
				<CategoryPanel key={cat.category} cat={cat} />
			))}
		</div>
	);
}
