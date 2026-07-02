import Link from "next/link";
import { notFound } from "next/navigation";
import { buildUniqueItems } from "@/lib/page-gap-artifacts";
import type { GapDimension, SubScores } from "@/lib/page-gap-engine";
import { planSchemaTypeNames } from "@/lib/page-gap-schema";
import { getPageGapRun } from "@/lib/page-gap-store";
import { AnalyzePageGapButton } from "../AnalyzePageGapButton";
import { Artifacts } from "../Artifacts";
import { ExportButtons } from "../ExportButtons";
import { GapFindings } from "../GapFindings";
import { GenerateSchemaButton } from "../GenerateSchemaButton";
import { Md, MdBlock } from "../Markdown";
import { PromptFinder } from "../PromptFinder";
import { ReRunButton } from "../ReRunButton";
import { SchemaBlock } from "../SchemaBlock";
import { SopScorecardView } from "../SopScorecardView";

const DIM_META: Record<GapDimension, { label: string; weight: number }> = {
	intent_match: { label: "Intent Match", weight: 22 },
	content_quality: { label: "Content Quality", weight: 20 },
	geo_readiness: { label: "GEO Readiness", weight: 15 },
	eeat: { label: "E-E-A-T", weight: 15 },
	onpage_seo: { label: "On-page SEO", weight: 10 },
	structured_data: { label: "Structured Data", weight: 10 },
	internal_linking: { label: "Internal Linking", weight: 5 },
	conversion: { label: "Conversion", weight: 3 },
};

const DIM_ORDER = Object.keys(DIM_META) as GapDimension[];

function Bar({ value, color }: { value: number; color: string }) {
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
			<div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
		</div>
	);
}

function median(nums: number[]): number {
	const s = [...nums].filter(n => n > 0).sort((a, b) => a - b);
	if (!s.length) return 0;
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function Yes({ v }: { v: boolean }) {
	return <span style={{ color: v ? "var(--color-success)" : "var(--color-muted)" }}>{v ? "✓" : "·"}</span>;
}

function LlmList({ title, items }: { title: string; items: string[] }) {
	if (!items.length) return null;
	return (
		<div className="space-y-1.5">
			{title && <h3 className="text-sm font-semibold">{title}</h3>}
			<ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-muted)]">
				{items.map((x, i) => (
					<li key={i}>
						<Md>{x}</Md>
					</li>
				))}
			</ul>
		</div>
	);
}

export default async function PageGapReport({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const run = await getPageGapRun(id);
	if (!run) notFound();

	const { report, llm, llmStatus, llmError, schema, schemaStatus, schemaError } = run;

	// Merge the LLM's per-gap fixes inline into each finding (issue: AI must add
	// suggestions across every analysis point, not only the opportunity section).
	if (llm?.gapFixes) {
		for (const g of report.gaps) {
			const fix = llm.gapFixes[g.id];
			if (fix) g.suggested_fix = fix;
		}
	}

	// Prefer the AI-refined prompt finder; fall back to the deterministic baseline.
	const pf = llm?.promptFinder ?? report.promptFinder;

	const i = report.intent;
	const comp = i.composition;
	const subScores: SubScores = report.subScores;
	const compWordMedian = median(report.benchmark.filter(b => b.rank > 0).map(b => b.word_count));

	const sevColor =
		report.score >= 75 ? "var(--color-success)" : report.score >= 50 ? "var(--color-warning)" : "var(--color-danger)";

	// Target Artifacts data (assembled server-side, passed to the client view).
	const schemaTypeNames = planSchemaTypeNames(report);
	const uniqueItems = buildUniqueItems(report);

	const plan = llm?.priorityActionPlan;
	const hasActionPlan =
		!!plan &&
		(plan.critical.length || plan.quickWins.length || plan.mediumFixes.length || plan.strategicRewrites.length);

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<Link href="/page-gap" className="text-xs text-[var(--color-accent)]">
						← All runs
					</Link>
					<h1 className="mt-1 text-2xl font-bold">{report.keyword}</h1>
					<div className="font-mono text-xs text-[var(--color-accent)]">{report.targetUrl}</div>
					<div className="mt-1 text-xs text-[var(--color-muted)]">
						{new Date(report.fetchedAt).toLocaleString()} · {report.country}/{report.device}
					</div>
				</div>
				<div className="flex flex-col items-end gap-2">
					<ReRunButton
						url={report.targetUrl}
						keyword={report.keyword}
						country={report.country}
						device={report.device === "mobile" ? "mobile" : "desktop"}
					/>
					<AnalyzePageGapButton runId={run.id} status={llmStatus} />
					<ExportButtons data={{ report, llm, schema }} runId={run.id} />
				</div>
			</div>

			{report.warnings.length > 0 && (
				<div className="card border-[var(--color-warning)]/40 p-4 text-sm text-[var(--color-warning)]">
					{report.warnings.map((w, idx) => (
						<div key={idx}>⚠ {w}</div>
					))}
				</div>
			)}

			{/* Score + subscores */}
			<div className="card p-6 space-y-5">
				<div className="flex flex-wrap items-center gap-6">
					<div>
						<div className="text-5xl font-bold" style={{ color: sevColor }}>
							{report.score}
						</div>
						<div className="mt-0.5 text-xs text-[var(--color-muted)]">
							{report.sopScorecard ? "SOP Score / 100" : "Gap Score / 100"}
						</div>
					</div>
					{i.mismatch ? (
						<span className="rounded-full border border-[var(--color-danger)]/50 px-3 py-1 text-xs uppercase tracking-wide text-[var(--color-danger)]">
							Critical intent mismatch
						</span>
					) : (
						<span className="rounded-full border border-[var(--color-success)]/50 px-3 py-1 text-xs uppercase tracking-wide text-[var(--color-success)]">
							Intent: pass
						</span>
					)}
				</div>
				{report.sopScorecard && (
					<div className="flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-3">
						{report.sopScorecard.categories.map(cat => {
							const c = cat.score >= 75 ? "#34d399" : cat.score >= 50 ? "#fbbf24" : "#f87171";
							return (
								<div
									key={cat.category}
									className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5"
								>
									<span className="text-xs font-medium">{cat.label}</span>
									<span className="text-sm font-bold" style={{ color: c }}>
										{cat.score}
									</span>
								</div>
							);
						})}
					</div>
				)}
				<div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
					Internal dimension scoring (secondary)
				</div>
				<div className="grid grid-cols-1 gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2 lg:grid-cols-4">
					{DIM_ORDER.map(dim => {
						const score = Math.round(subScores[dim] ?? 0);
						const color = score >= 75 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
						return (
							<div key={dim} className="space-y-1.5">
								<div className="flex justify-between text-xs">
									<span className="font-medium">{DIM_META[dim].label}</span>
									<span className="text-[var(--color-muted)]">{score}/100</span>
								</div>
								<Bar value={score} color={color} />
								<div className="text-[10px] text-[var(--color-muted)]">weight {DIM_META[dim].weight}</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Section 1 — Competitor Analysis (benchmark + ranking patterns) */}
			<div className="card p-6 space-y-3">
				<div>
					<h2 className="font-semibold">1 · Competitor Analysis</h2>
					<p className="text-sm text-[var(--color-muted)]">
						The live top-10 ranking pages for this keyword, every signal benchmarked against your page (★).
					</p>
				</div>
				<div className="overflow-auto rounded-md border border-[var(--color-border)]">
					<table className="w-full text-xs">
						<thead className="bg-[var(--color-surface-2)] text-left">
							<tr>
								{[
									"#",
									"Domain",
									"Type",
									"Words",
									"H2",
									"FAQ",
									"Table",
									"Calc",
									"CTA",
									"Sticky",
									"Author",
									"Date",
									"Svc-link",
									"Schema",
									"Answer-1st",
									"Q-head",
								].map(h => (
									<th key={h} className="whitespace-nowrap px-2.5 py-2">
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{report.benchmark.map(b => {
								const isTarget = b.rank === 0;
								return (
									<tr
										key={`${b.rank}-${b.domain}`}
										className={`border-t border-[var(--color-border)] ${
											isTarget ? "bg-[var(--color-surface-2)] font-medium" : ""
										}`}
									>
										<td className="px-2.5 py-1.5">{isTarget ? "★" : b.rank}</td>
										<td className="px-2.5 py-1.5 max-w-[160px] truncate">{b.domain}</td>
										<td className="px-2.5 py-1.5 whitespace-nowrap text-[var(--color-muted)]">
											{b.page_type.replace("_", "/")}
										</td>
										<td
											className="px-2.5 py-1.5"
											style={{
												color:
													isTarget && compWordMedian
														? b.word_count >= compWordMedian
															? "var(--color-success)"
															: "var(--color-danger)"
														: undefined,
											}}
										>
											{b.word_count}
										</td>
										<td className="px-2.5 py-1.5">{b.h2_count}</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.has_faq} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.has_table} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.has_calculator} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.has_inline_cta} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.has_sticky_cta} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.has_named_author} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.has_updated_date} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.internal_link_to_service} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.schema_types.length > 0} />
										</td>
										<td className="px-2.5 py-1.5">
											<Yes v={b.geo_answer_first} />
										</td>
										<td className="px-2.5 py-1.5">{b.geo_question_headings}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				<p className="text-[10px] text-[var(--color-muted)]">
					★ = your page. Word count is green when it meets or beats the competitor median ({compWordMedian}).
				</p>
				{llm && (llm.rankingPatternSummary || llm.top3Differentiators.length > 0) && (
					<div className="space-y-4 border-t border-[var(--color-border)] pt-4">
						{llm.rankingPatternSummary && (
							<MdBlock text={llm.rankingPatternSummary} className="text-sm text-[var(--color-muted)]" />
						)}
						<LlmList title="Top differentiators" items={llm.top3Differentiators} />
					</div>
				)}
			</div>

			{/* Section 2 — SERP Intent Analysis */}
			<div className="card p-6 space-y-4">
				<div>
					<h2 className="font-semibold">2 · SERP Intent Analysis</h2>
					<p className="text-sm text-[var(--color-muted)]">
						If your page type does not match what Google rewards for this keyword, this overrides every other
						finding.
					</p>
				</div>

				<div className="grid gap-4 lg:grid-cols-2">
					<div className="space-y-3">
						<div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
							<div className="text-xs text-[var(--color-muted)]">SERP verdict (Rule {i.ruleApplied})</div>
							<div className="mt-1 font-semibold">{i.verdictLabel}</div>
							<div className="mt-2 flex flex-wrap gap-2 text-xs">
								<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)]">
									Your page: {i.targetPageType.replace("_", "/")}
									{report.target.features.pageTypeScore && (
										<span className="ml-1 opacity-70">
											({report.target.features.pageTypeScore.confidence}% conf · C
											{report.target.features.pageTypeScore.commercial}/I
											{report.target.features.pageTypeScore.informational})
										</span>
									)}
								</span>
								{i.actionModifiers.length > 0 && (
									<span className="rounded border border-[#fb923c]/40 px-2 py-0.5 text-[#fb923c]">
										action modifier: {i.actionModifiers.join(", ")}
									</span>
								)}
								{i.bareKeyword && (
									<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)]">
										bare keyword
									</span>
								)}
							</div>
						</div>
						<p className="text-xs text-[var(--color-muted)]">{i.reason}</p>
					</div>

					<div className="space-y-2">
						<div className="text-xs text-[var(--color-muted)]">SERP composition ({comp.total} classified)</div>
						{[
							{ label: "Product / service / landing", value: comp.commercial, color: "#60a5fa" },
							{ label: "Blog / guide / informational", value: comp.informational, color: "#a78bfa" },
							{ label: "Hybrid", value: comp.hybrid, color: "#34d399" },
							{ label: "Comparison", value: comp.comparison, color: "#fbbf24" },
						].map(row => (
							<div key={row.label} className="space-y-1">
								<div className="flex justify-between text-xs">
									<span>{row.label}</span>
									<span className="text-[var(--color-muted)]">
										{row.value}/{comp.total || 0}
									</span>
								</div>
								<Bar value={comp.total ? (row.value / comp.total) * 100 : 0} color={row.color} />
							</div>
						))}
					</div>
				</div>

				{llm?.intentVerdictNarrative && (
					<MdBlock
						text={llm.intentVerdictNarrative}
						className="border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-muted)]"
					/>
				)}
			</div>

			{/* Section 3 — Page Gap Analysis (SOP scorecard + dissolved opportunities & action plan) */}
			<div className="card p-6 space-y-4">
				<div>
					<h2 className="font-semibold">3 · Page Gap Analysis</h2>
					<p className="text-sm text-[var(--color-muted)]">
						{report.sopScorecard
							? "Every Technical-SEO, On-Page-SEO and GEO action item from the SEO Master SOP, scored against this exact page and the live SERP. Fix the flagged items top-down; passing items are listed for confirmation."
							: "Each gap is evidenced by the ranking pages that prove it. Gaps with fewer than 3 supporting pages are labelled best-practice, not SERP-validated."}
					</p>
				</div>

				{report.sopScorecard ? (
					<SopScorecardView scorecard={report.sopScorecard} />
				) : (
					<GapFindings gaps={report.gaps} />
				)}

				{llm && (
					<div className="space-y-5 border-t border-[var(--color-border)] pt-4">
						<LlmList title="Opportunities to own" items={llm.opportunityHighlights} />
						{hasActionPlan && (
							<div className="space-y-3">
								<h3 className="text-sm font-semibold">Prioritised action plan</h3>
								<div className="grid gap-5 lg:grid-cols-2">
									<LlmList title="Critical" items={plan.critical} />
									<LlmList title="Quick wins" items={plan.quickWins} />
									<LlmList title="Medium fixes" items={plan.mediumFixes} />
									<LlmList title="Strategic rewrites" items={plan.strategicRewrites} />
								</div>
							</div>
						)}
						{(llm.contentQualityFindings.length > 0 || llm.geoFindings.length > 0) && (
							<div className="grid gap-5 lg:grid-cols-2">
								<LlmList title="Content quality" items={llm.contentQualityFindings} />
								<LlmList title="GEO / AI readiness" items={llm.geoFindings} />
							</div>
						)}
						<LlmList title="SERP-sourced recommendations" items={llm.sourcedRecommendations} />
						{llm.confidenceNotes && (
							<MdBlock
								text={llm.confidenceNotes}
								className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted)]"
							/>
						)}
					</div>
				)}
				{!llm && llmStatus === "error" && (
					<p className="border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-danger)]">
						AI analysis failed: {llmError}
					</p>
				)}
			</div>

			{/* Section 4 — Prompts for GEO Mentions & Citation */}
			{pf && (
				<div className="card p-6 space-y-4">
					<div>
						<h2 className="font-semibold">4 · Prompts For GEO Mentions & Citation</h2>
						<p className="text-sm text-[var(--color-muted)]">
							The AI prompts this page should be cited in across ChatGPT, Perplexity, Gemini and Google AI
							Overviews — each mapped to the exact GEO items to update to win it.
							{pf.source === "deterministic" &&
								" Generate the AI analysis to refine the industry, niche, and prompt set with your model."}
						</p>
					</div>
					<PromptFinder data={pf} />
				</div>
			)}

			{/* Section 5 — Schema Generator (button moved into the block, bottom-left) */}
			<div className="card p-6 space-y-4">
				<div>
					<h2 className="font-semibold">5 · Schema Generator</h2>
					<p className="text-sm text-[var(--color-muted)]">
						Ready-to-paste Schema.org JSON-LD for this page. The types come from the schema set in the Target
						Artifacts below; the connected AI model writes the content (FAQ answers, descriptions) where required.
						It only emits a type the page has content to support — it never fabricates.
					</p>
				</div>
				{schema ? (
					<SchemaBlock schema={schema} targetUrl={report.targetUrl} runId={run.id} />
				) : (
					<p className="text-sm text-[var(--color-muted)]">
						{schemaStatus === "error"
							? `Schema generation failed: ${schemaError}`
							: "Generate the schema to build Schema.org JSON-LD for the target URL, sourced from the schema set and page signals."}
					</p>
				)}
				<div className="border-t border-[var(--color-border)] pt-4">
					<GenerateSchemaButton runId={run.id} status={schemaStatus} />
				</div>
			</div>

			{/* Section 6 — Target Artifacts */}
			<div className="card p-6 space-y-4">
				<div>
					<h2 className="font-semibold">6 · Target Artifacts</h2>
					<p className="text-sm text-[var(--color-muted)]">
						What the target page should become: the heading structure to adopt, the schema set to declare, the
						links it currently has, and the unique items worth pursuing from the ranking pages.
					</p>
				</div>
				<Artifacts
					headingBlueprint={llm?.headingBlueprint ?? []}
					schemaTypeNames={schemaTypeNames}
					links={report.target.links}
					uniqueItems={uniqueItems}
					aiReady={!!llm}
				/>
			</div>
		</div>
	);
}
