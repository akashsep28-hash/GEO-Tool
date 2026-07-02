import Link from "next/link";
import { getActor } from "@/lib/actor";
import { listAuditPages } from "@/lib/audit-pages";
import { getGuestAudit, getGuestProject } from "@/lib/guest-session";
import { createClient } from "@/lib/supabase/server";
import { AnalyzeAllButton } from "./AnalyzeAllButton";
import { RunAuditButton } from "./RunAuditButton";

const AI_STATUS_STYLE: Record<string, string> = {
	done: "text-[var(--color-success)] border-[var(--color-success)]/40",
	running: "text-[var(--color-warning)] border-[var(--color-warning)]/40",
	error: "text-[var(--color-danger)] border-[var(--color-danger)]/40",
	pending: "text-[var(--color-muted)] border-[var(--color-border)]",
};

type FindingRow = {
	severity: string;
	category: string;
	title: string;
	problem: string;
	fix: string;
	evidence: string | null;
	sop_ref: string | null;
	dimension: string | null;
};

type Dimension = "citability" | "structural" | "multimodal" | "authority" | "technical";

type PageSummary = {
	url: string;
	title: string;
	status: number;
	wordCount: number;
	h1Count: number;
	h2Count: number;
	schemaTypes: string[];
	issues: string[];
};

type AuditSummary = {
	dimensions?: Record<Dimension, number>;
	crawledPages?: number;
	discoveredUrls?: number;
	checkedFiles?: string[];
	failedPages?: number;
	wordCount?: number;
	averageWordsPerPage?: number;
	thinPages?: number;
	clientRenderedPages?: number;
	duplicateTitleCount?: number;
	pagesWithoutCanonical?: number;
	pagesWithoutSchema?: number;
	pagesWithoutAuthor?: number;
	pagesWithoutDate?: number;
	pagesWithoutQuestionHeadings?: number;
	pagesWithFaq?: number;
	pagesWithTables?: number;
	pagesWithVideo?: number;
	pagesWithQualityCitations?: number;
	pdfCount?: number;
	documentCount?: number;
	imageFileCount?: number;
	blockedCrawlers?: string[];
	hasLlmsTxt?: boolean;
	hasSitemap?: boolean;
	crawledPageSummaries?: PageSummary[];
};

const SEV_STYLE: Record<string, string> = {
	critical: "text-[var(--color-danger)] border-[var(--color-danger)]/40",
	high: "text-[#fb923c] border-[#fb923c]/40",
	medium: "text-[var(--color-warning)] border-[var(--color-warning)]/40",
	low: "text-[var(--color-accent)] border-[var(--color-accent)]/40",
	pass: "text-[var(--color-success)] border-[var(--color-success)]/40",
};

const DIM_META: Record<Dimension, { label: string; weight: string; color: string }> = {
	citability: { label: "Citability", weight: "25%", color: "#a78bfa" },
	authority: { label: "Authority", weight: "20%", color: "#34d399" },
	technical: { label: "Technical", weight: "20%", color: "#60a5fa" },
	structural: { label: "Structural", weight: "20%", color: "#fbbf24" },
	multimodal: { label: "Multi-modal", weight: "15%", color: "#f472b6" },
};

const DIM_ORDER: Dimension[] = ["citability", "authority", "technical", "structural", "multimodal"];

function ScoreBar({ value, color }: { value: number; color: string }) {
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
			<div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
		</div>
	);
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warn" | "bad" }) {
	const color =
		tone === "good"
			? "var(--color-success)"
			: tone === "bad"
				? "var(--color-danger)"
				: tone === "warn"
					? "var(--color-warning)"
					: "var(--color-fg)";

	return (
		<div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
			<div className="text-xs text-[var(--color-muted)]">{label}</div>
			<div className="mt-1 text-lg font-semibold" style={{ color }}>
				{value}
			</div>
		</div>
	);
}

export default async function AuditPage() {
	const actor = await getActor();

	let project: { website_url: string; name: string } | null = null;
	let audit: { id: string; score: number | null; created_at: string; summary: unknown } | null = null;
	let findings: FindingRow[] | null = null;

	if (actor.kind === "guest") {
		const gp = await getGuestProject();
		project = gp ? { website_url: gp.website_url, name: gp.name } : null;
		const ga = await getGuestAudit();
		if (ga) {
			audit = {
				id: ga.id,
				score: ga.score,
				created_at: ga.created_at,
				summary: ga.summary,
			};
			findings = ga.findings.map(f => ({
				severity: f.severity,
				category: f.category,
				title: f.title,
				problem: f.problem,
				fix: f.fix,
				evidence: f.evidence ?? null,
				sop_ref: f.sop_ref ?? null,
				dimension: f.dimension,
			}));
		}
	} else {
		const supabase = await createClient();

		const { data: p } = await supabase
			.from("projects")
			.select("website_url, name")
			.eq("is_primary", true)
			.maybeSingle();
		project = p ?? null;

		const { data: a } = await supabase
			.from("audits")
			.select("id, score, created_at, summary")
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		audit = a ?? null;

		const { data: f } = audit
			? await supabase
					.from("audit_findings")
					.select("severity, category, title, problem, fix, evidence, sop_ref, dimension")
					.eq("audit_id", audit.id)
			: { data: null };
		findings = f ?? null;
	}

	const order = ["critical", "high", "medium", "low", "pass"];
	const sorted = (findings ?? []).sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
	const counts = sorted.reduce<Record<string, number>>((acc, f) => {
		acc[f.severity] = (acc[f.severity] ?? 0) + 1;
		return acc;
	}, {});

	const summary = (audit?.summary ?? {}) as AuditSummary;
	const dimensions = summary.dimensions;
	const pages = summary.crawledPageSummaries ?? [];

	// Per-page records for the AI auditor agent (stored HTML + AI status).
	const auditPages = audit ? await listAuditPages(audit.id) : [];
	const pendingAiPages = auditPages.filter(p => p.ok && p.aiStatus === "pending").map(p => ({ id: p.id, url: p.url }));

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold">Website GEO Audit</h1>
					<p className="text-[var(--color-muted)]">
						Full-site crawl, root-file checks, page parsing, and fix-first GEO recommendations.
					</p>
				</div>
				<RunAuditButton label={audit ? "Re-run audit" : "Run audit"} />
			</div>

			{!audit && (
				<div className="card p-8 text-center">
					<p className="text-[var(--color-muted)]">
						No audit yet for {project?.name ?? "your site"}. Run one to crawl the site, parse pages, and generate
						fixes.
					</p>
				</div>
			)}

			{audit && (
				<>
					<div className="card p-6 space-y-5">
						<div className="flex flex-wrap items-center gap-6">
							<div>
								<div className="text-5xl font-bold">{audit.score}</div>
								<div className="mt-0.5 text-xs text-[var(--color-muted)]">GEO Score / 100</div>
							</div>
							<div className="flex flex-wrap gap-2">
								{order.map(sev =>
									counts[sev] ? (
										<span
											key={sev}
											className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wide ${SEV_STYLE[sev]}`}
										>
											{counts[sev]} {sev}
										</span>
									) : null,
								)}
							</div>
							<div className="ml-auto text-xs text-[var(--color-muted)]">
								{project?.website_url} | {new Date(audit.created_at).toLocaleString()}
							</div>
						</div>

						{dimensions && (
							<div className="grid grid-cols-1 gap-3 border-t border-[var(--color-border)] pt-2 sm:grid-cols-2 lg:grid-cols-5">
								{DIM_ORDER.map(dim => {
									const { label, weight, color } = DIM_META[dim];
									const score = Math.round(dimensions[dim] ?? 0);
									return (
										<div key={dim} className="space-y-1.5">
											<div className="flex justify-between text-xs">
												<span className="font-medium" style={{ color }}>
													{label}
												</span>
												<span className="text-[var(--color-muted)]">{score}/100</span>
											</div>
											<ScoreBar value={score} color={color} />
											<div className="text-[10px] text-[var(--color-muted)]">weight {weight}</div>
										</div>
									);
								})}
							</div>
						)}
					</div>

					{/* AI page auditor — per-page stored HTML + agent analysis */}
					<div className="card p-6 space-y-4">
						<div className="flex flex-wrap items-start justify-between gap-4">
							<div>
								<h2 className="font-semibold">AI page auditor</h2>
								<p className="text-sm text-[var(--color-muted)]">
									Full HTML is parsed and stored for every page. Open a page for its issues, gaps, and an
									AI-generated corrected version — or analyze them all with your connected model.
								</p>
							</div>
							{audit && auditPages.length > 0 && (
								<AnalyzeAllButton auditId={audit.id} pendingPages={pendingAiPages} />
							)}
						</div>
						{auditPages.length === 0 ? (
							<p className="text-sm text-[var(--color-muted)]">
								No stored pages for this audit yet. Re-run the audit to capture per-page HTML.
							</p>
						) : (
							<div className="space-y-2">
								{auditPages.map(p => (
									<Link
										key={p.id}
										href={`/audit/page/${p.id}`}
										className="block rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 transition-colors hover:border-[var(--color-brand)]"
									>
										<div className="flex items-center justify-between gap-3">
											<div className="min-w-0">
												<div className="truncate font-medium">{p.title || "Untitled page"}</div>
												<div className="truncate font-mono text-xs text-[var(--color-accent)]">{p.url}</div>
											</div>
											<div className="flex shrink-0 items-center gap-2 text-[10px] uppercase tracking-wide">
												<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)]">
													{p.wordCount}w
												</span>
												{p.notWorkingCount > 0 && (
													<span className="rounded border border-[var(--color-danger)]/40 px-2 py-0.5 text-[var(--color-danger)]">
														{p.notWorkingCount} gaps
													</span>
												)}
												<span className={`rounded border px-2 py-0.5 ${AI_STATUS_STYLE[p.aiStatus]}`}>
													{p.aiStatus === "done" ? "AI ✓" : p.aiStatus}
												</span>
											</div>
										</div>
									</Link>
								))}
							</div>
						)}
					</div>

					<div className="card p-6 space-y-4">
						<div>
							<h2 className="font-semibold">Crawl Coverage</h2>
							<p className="text-sm text-[var(--color-muted)]">
								The audit checked pages, internal links, sitemap discovery, robots rules, llms.txt, and linked
								files.
							</p>
						</div>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<Metric label="Pages crawled" value={summary.crawledPages ?? 0} />
							<Metric label="URLs discovered" value={summary.discoveredUrls ?? 0} />
							<Metric
								label="Failed pages"
								value={summary.failedPages ?? 0}
								tone={summary.failedPages ? "bad" : "good"}
							/>
							<Metric label="Avg words/page" value={summary.averageWordsPerPage ?? 0} />
							<Metric
								label="llms.txt"
								value={summary.hasLlmsTxt ? "Found" : "Missing"}
								tone={summary.hasLlmsTxt ? "good" : "warn"}
							/>
							<Metric
								label="Sitemap"
								value={summary.hasSitemap ? "Found" : "Missing"}
								tone={summary.hasSitemap ? "good" : "bad"}
							/>
							<Metric label="Root files" value={summary.checkedFiles?.length ?? 0} />
							<Metric
								label="AI bots blocked"
								value={summary.blockedCrawlers?.length ?? 0}
								tone={summary.blockedCrawlers?.length ? "bad" : "good"}
							/>
						</div>
					</div>

					<div className="grid gap-4 lg:grid-cols-2">
						<div className="card p-6 space-y-3">
							<h2 className="font-semibold">Content Gaps</h2>
							<div className="grid gap-3 sm:grid-cols-2">
								<Metric label="Thin pages" value={summary.thinPages ?? 0} />
								<Metric label="No question headings" value={summary.pagesWithoutQuestionHeadings ?? 0} />
								<Metric label="No author signal" value={summary.pagesWithoutAuthor ?? 0} />
								<Metric label="No date signal" value={summary.pagesWithoutDate ?? 0} />
							</div>
						</div>
						<div className="card p-6 space-y-3">
							<h2 className="font-semibold">Technical Gaps</h2>
							<div className="grid gap-3 sm:grid-cols-2">
								<Metric label="No schema" value={summary.pagesWithoutSchema ?? 0} />
								<Metric label="No canonical" value={summary.pagesWithoutCanonical ?? 0} />
								<Metric
									label="Client-render risk"
									value={summary.clientRenderedPages ?? 0}
									tone={summary.clientRenderedPages ? "bad" : "good"}
								/>
								<Metric label="Duplicate titles" value={summary.duplicateTitleCount ?? 0} />
							</div>
						</div>
					</div>

					{pages.length > 0 && (
						<div className="card p-6 space-y-4">
							<div>
								<h2 className="font-semibold">Pages Checked</h2>
								<p className="text-sm text-[var(--color-muted)]">
									Showing the first {pages.length} crawled pages saved with the audit.
								</p>
							</div>
							<div className="space-y-3">
								{pages.map(page => (
									<div
										key={page.url}
										className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
									>
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium">{page.title || "Untitled page"}</span>
											<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]">
												{page.wordCount} words
											</span>
											<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]">
												H1 {page.h1Count} | H2 {page.h2Count}
											</span>
										</div>
										<div className="mt-1 break-all font-mono text-xs text-[var(--color-accent)]">
											{page.url}
										</div>
										<div className="mt-2 flex flex-wrap gap-1">
											{(page.schemaTypes.length ? page.schemaTypes : ["No schema"]).map(schema => (
												<span
													key={schema}
													className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]"
												>
													{schema}
												</span>
											))}
										</div>
										{page.issues.length > 0 && (
											<div className="mt-3 text-sm text-[var(--color-muted)]">
												Issues: {page.issues.join(", ")}
											</div>
										)}
									</div>
								))}
							</div>
						</div>
					)}

					<div className="space-y-3">
						{sorted.map((f, i) => {
							const dimMeta =
								f.dimension && DIM_META[f.dimension as Dimension] ? DIM_META[f.dimension as Dimension] : null;
							return (
								<div key={i} className="card p-5">
									<div className="flex flex-wrap items-center gap-2">
										<span
											className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${SEV_STYLE[f.severity]}`}
										>
											{f.severity}
										</span>
										{dimMeta && (
											<span
												className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide"
												style={{
													color: dimMeta.color,
													borderColor: `${dimMeta.color}40`,
												}}
											>
												{dimMeta.label}
											</span>
										)}
										<span className="font-semibold">{f.title}</span>
										{f.sop_ref && (
											<span className="ml-auto text-xs text-[var(--color-muted)]">SOP {f.sop_ref}</span>
										)}
									</div>
									{f.severity !== "pass" ? (
										<>
											<p className="mt-3 text-sm text-[var(--color-muted)]">
												<span className="font-medium text-[var(--color-fg)]">Problem: </span>
												{f.problem}
											</p>
											<p className="mt-2 text-sm text-[var(--color-muted)]">
												<span className="font-medium" style={{ color: "var(--color-success)" }}>
													Fix:{" "}
												</span>
												{f.fix}
											</p>
											{f.evidence && (
												<pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs text-[var(--color-muted)]">
													{f.evidence}
												</pre>
											)}
										</>
									) : (
										<p className="mt-2 text-sm text-[var(--color-muted)]">{f.problem}</p>
									)}
								</div>
							);
						})}
					</div>
				</>
			)}
		</div>
	);
}
