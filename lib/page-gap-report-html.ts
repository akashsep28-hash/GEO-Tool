/**
 * Print-quality HTML for the Page Gap report. This single self-contained HTML
 * document (inline CSS, no external assets) is rendered to PDF by headless
 * Chrome via Playwright (lib/browser.ts → renderPdf). Using a real layout engine
 * — instead of hand-written OOXML — is what makes the PDF actually readable:
 * proper tables, controlled page breaks, wrapped URLs, consistent margins.
 *
 * Pure + client-safe (no server-only imports), so it can be reused for an
 * on-screen "print" view later if wanted.
 */
import { buildUniqueItems } from "@/lib/page-gap-artifacts";
import type { ExportInput } from "@/lib/page-gap-export";
import { schemaScriptTag } from "@/lib/page-gap-export";
import type { SopStatus } from "@/lib/page-gap-sop";

// ---- Brand palette (matches the DOCX builder we replaced) ------------------
const GREEN_DARK = "#1B4332";
const GREEN_MED = "#2D6A4F";
const GREEN_ACCENT = "#40916C";
const INK = "#1A1A1A";
const GREY = "#5f6b66";
const BORDER = "#d7e3dc";

const SEV: Record<string, string> = {
	critical: "#C00000",
	high: "#D9730D",
	medium: "#B8860B",
	low: "#52796F",
	pass: GREEN_MED,
};

const STATUS_STYLE: Record<SopStatus, { label: string; color: string; bg: string }> = {
	pass: { label: "PASS", color: "#1f7a4d", bg: "#e7f5ee" },
	partial: { label: "PARTIAL", color: "#9a6a00", bg: "#fdf3df" },
	fail: { label: "FAIL", color: "#b42318", bg: "#fdecea" },
	unknown: { label: "NO DATA", color: "#5f6b66", bg: "#eef1f0" },
	not_applicable: { label: "N/A", color: "#6b7280", bg: "#f0f1f2" },
};

function esc(s: unknown): string {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Render inline **bold** markdown (the LLM emits it) into safe HTML. */
function md(text: string): string {
	return esc(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function scoreColor(v: number): string {
	return v >= 75 ? "#1f7a4d" : v >= 50 ? "#b8860b" : "#b42318";
}

function chip(status: SopStatus): string {
	const s = STATUS_STYLE[status];
	return `<span class="chip" style="color:${s.color};background:${s.bg};border-color:${s.color}40">${s.label}</span>`;
}

function styles(): string {
	return `
@page { size: A4; margin: 14mm 13mm 16mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: ${INK};
	font-size: 10.5px; line-height: 1.5; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 21px; color: ${GREEN_DARK}; margin: 0 0 4px; }
h2 { font-size: 15px; color: ${GREEN_MED}; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 2px solid ${GREEN_ACCENT}; break-after: avoid; }
h3 { font-size: 12px; color: ${GREEN_MED}; margin: 12px 0 4px; break-after: avoid; }
a { color: ${GREEN_MED}; text-decoration: none; word-break: break-all; }
p { margin: 0 0 6px; }
.muted { color: ${GREY}; }
.section { margin: 0 0 18px; break-inside: avoid-page; }
.meta { color: ${GREY}; font-size: 10px; }
.url { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; color: ${GREEN_MED}; word-break: break-all; }

.cover { display: flex; align-items: flex-end; gap: 22px; border-bottom: 3px solid ${GREEN_DARK}; padding-bottom: 12px; margin-bottom: 16px; }
.cover .score { font-size: 52px; font-weight: 800; line-height: 1; }
.cover .score small { font-size: 13px; font-weight: 500; color: ${GREY}; }
.catpills { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.catpill { border: 1px solid ${BORDER}; border-radius: 6px; padding: 3px 9px; font-size: 10px; }
.catpill b { font-size: 13px; }

table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 9.5px; }
th { background: ${GREEN_DARK}; color: #fff; text-align: left; padding: 5px 7px; font-weight: 600; }
td { padding: 5px 7px; border-bottom: 1px solid ${BORDER}; vertical-align: top; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
.num { text-align: right; white-space: nowrap; }
.target-row td { background: #eef5f0; font-weight: 600; }

.chip { display: inline-block; font-size: 8.5px; font-weight: 700; letter-spacing: .04em;
	padding: 1.5px 6px; border-radius: 9px; border: 1px solid; white-space: nowrap; }

.sop-item { padding: 8px 0; border-bottom: 1px solid ${BORDER}; break-inside: avoid; }
.sop-item:last-child { border-bottom: 0; }
.sop-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.sop-title { font-weight: 600; font-size: 11px; }
.sop-row { font-size: 8.5px; color: ${GREY}; white-space: nowrap; font-family: ui-monospace, Consolas, monospace; }
.sop-detail { color: ${GREY}; margin-top: 2px; }
.sop-rec { color: ${GREEN_MED}; margin-top: 3px; }
.sop-tags { margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; }
.tag { border: 1px solid ${BORDER}; border-radius: 4px; padding: 1px 6px; font-size: 8.5px; color: ${GREY};
	font-family: ui-monospace, Consolas, monospace; }
.passrow { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.passchip { border: 1px solid ${BORDER}; border-radius: 4px; padding: 1.5px 7px; font-size: 9px; color: ${GREY}; }

.gap { padding: 9px 0; border-bottom: 1px solid ${BORDER}; break-inside: avoid; }
.gap-title { font-weight: 700; font-size: 11.5px; }
.sev { display: inline-block; font-size: 8.5px; font-weight: 800; padding: 1px 6px; border-radius: 4px; color: #fff; margin-right: 6px; }
.kv { margin: 2px 0; }
.kv b { color: ${GREEN_MED}; }
.ev { color: ${GREY}; font-size: 9.5px; margin: 1px 0 1px 12px; }
ul { margin: 2px 0 6px; padding-left: 16px; }
li { margin: 1px 0; break-inside: avoid; }
.code { background: #f4f7f5; border: 1px solid ${BORDER}; border-radius: 5px; padding: 8px 10px;
	font-family: ui-monospace, Consolas, monospace; font-size: 8.5px; white-space: pre-wrap; word-break: break-all;
	break-inside: auto; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
`;
}

function coverSection(d: ExportInput): string {
	const { report } = d;
	const sc = report.sopScorecard;
	const targetUrl = report.target.finalUrl || report.targetUrl;
	const pills = sc
		? `<div class="catpills">${sc.categories
				.map(
					c =>
						`<span class="catpill">${esc(c.label)} <b style="color:${scoreColor(c.score)}">${c.score}</b><span class="muted">/100</span></span>`,
				)
				.join("")}</div>`
		: "";
	return `
<div class="cover">
	<div class="score" style="color:${scoreColor(report.score)}">${report.score}<small> / 100</small></div>
	<div style="flex:1">
		<h1>SEO Page Gap Report</h1>
		<div class="url">${esc(targetUrl)}</div>
		<div class="meta">Keyword: <strong>${esc(report.keyword)}</strong> · ${esc(new Date(report.fetchedAt).toLocaleString())} · ${esc(report.country)}/${esc(report.device)}${sc ? " · SOP score" : ""}</div>
		${pills}
	</div>
</div>`;
}

/** The single actionable section: failing/partial SOP items as findings, with
 * passing/not-assessed items listed compactly underneath each category. */
function findingsSection(d: ExportInput): string {
	const sc = d.report.sopScorecard;
	if (!sc) return legacyGapsSection(d); // old runs predate the SOP scorecard

	const rank = (s: string) => (s === "fail" ? 0 : s === "partial" ? 1 : 2);
	const finding = (it: (typeof sc.categories)[number]["items"][number]) => {
		const prev = it.serpPrevalence
			? `<span class="tag">${it.serpPrevalence.pass}/${it.serpPrevalence.total} ranking pages pass</span>`
			: "";
		const ev = it.evidence
			.slice(0, 3)
			.map(e => `<span class="tag">${esc(e)}</span>`)
			.join("");
		const tags = prev || ev ? `<div class="sop-tags">${prev}${ev}</div>` : "";
		return `
<div class="sop-item">
	<div class="sop-head">
		<div>${chip(it.status)} <span class="sop-title">${esc(it.title)}</span></div>
		<div class="sop-row">impact ${it.weight} · SOP r${it.sopRow} · ${esc(it.sopSource)}</div>
	</div>
	<div class="sop-detail">${esc(it.detail)}</div>
	<div class="sop-rec">→ ${esc(it.recommendation)}</div>
	${tags}
</div>`;
	};

	const cats = sc.categories
		.map(cat => {
			const issues = cat.items
				.filter(i => i.status === "fail" || i.status === "partial")
				.sort((a, b) => rank(a.status) - rank(b.status) || b.weight - a.weight);
			const rest = cat.items.filter(
				i => i.status === "pass" || i.status === "unknown" || i.status === "not_applicable",
			);
			const compact = rest
				.map(it => `<span class="passchip">${it.status === "pass" ? "✓" : "·"} ${esc(it.title)}</span>`)
				.join("");
			return `
<div class="section">
	<h3>${esc(cat.label)} — <span style="color:${scoreColor(cat.score)}">${cat.score}/100</span> <span class="muted">· ${issues.length ? `${issues.length} to fix` : "all clear"}</span></h3>
	${issues.map(finding).join("")}
	${compact ? `<div class="passrow">${compact}</div>` : ""}
</div>`;
		})
		.join("");
	const sources = `<p class="meta">PageSpeed: ${sc.dataSources.psiField ? "CrUX field data" : sc.dataSources.psi ? "lab only" : "unavailable"} · Site signals: ${sc.dataSources.site ? "fetched" : "unavailable"} · Deterministic — same URL + keyword always yields this result.</p>`;
	return `<div class="section" style="break-inside:auto"><h2>3 · Page Gap Analysis</h2>${sources}${cats}</div>`;
}

/** Legacy gap rendering for runs created before the SOP scorecard existed. */
function legacyGapsSection(d: ExportInput): string {
	const { report } = d;
	if (!report.gaps.length) return "";
	const urlByRank = new Map<number, string>();
	for (const c of report.competitors) urlByRank.set(c.rank, c.finalUrl || c.url);
	const items = report.gaps
		.map(g => {
			const ev = g.serp_evidence
				.map(
					e =>
						`<div class="ev">#${e.rank} ${esc(e.domain)} — ${esc(e.example_value)}${urlByRank.get(e.rank) ? ` — <span class="url">${esc(urlByRank.get(e.rank))}</span>` : ""}</div>`,
				)
				.join("");
			return `
<div class="gap">
	<div class="gap-title"><span class="sev" style="background:${SEV[g.severity] ?? GREY}">${g.severity.toUpperCase()}</span>${esc(g.title)}</div>
	<div class="kv muted">${esc(g.serp_prevalence)}${g.serp_validated ? " · SERP-validated" : " · best practice"}</div>
	<div class="kv"><b>Why:</b> ${esc(g.why_it_matters)}</div>
	<div class="kv"><b>Action:</b> ${esc(g.recommended_action)}</div>
	${g.suggested_fix ? `<div class="kv"><b>AI fix:</b> ${md(g.suggested_fix)}</div>` : ""}
	${ev}
</div>`;
		})
		.join("");
	return `<div class="section" style="break-inside:auto"><h2>3 · Page Gap Analysis</h2>${items}</div>`;
}

function intentSection(d: ExportInput): string {
	const i = d.report.intent;
	const c = i.composition;
	const ts = d.report.target.features.pageTypeScore;
	return `
<div class="section">
	<h2>2 · SERP Intent Analysis</h2>
	<p class="kv"><b>Verdict (Rule ${i.ruleApplied}):</b> ${esc(i.verdictLabel)}</p>
	<p class="kv"><b>Your page type:</b> ${esc(i.targetPageType.replace("_", "/"))}${ts ? ` (${ts.confidence}% confidence · C${ts.commercial}/I${ts.informational})` : ""}</p>
	<p class="kv"><b>Intent mismatch:</b> <span style="color:${i.mismatch ? SEV.critical : GREEN_MED};font-weight:700">${i.mismatch ? "YES — critical" : "No"}</span></p>
	<p class="kv"><b>SERP composition (${c.total}):</b> product/service ${c.commercial}, blog/guide ${c.informational}, hybrid ${c.hybrid}, comparison ${c.comparison}</p>
	<p class="muted">${esc(i.reason)}</p>
</div>`;
}

function benchmarkSection(d: ExportInput): string {
	const { report } = d;
	const urlByRank = new Map<number, string>();
	for (const c of report.competitors) urlByRank.set(c.rank, c.finalUrl || c.url);
	const targetUrl = report.target.finalUrl || report.targetUrl;
	const rows = report.benchmark
		.map(b => {
			const url = b.rank === 0 ? targetUrl : urlByRank.get(b.rank) || b.domain;
			return `<tr class="${b.rank === 0 ? "target-row" : ""}">
	<td class="num">${b.rank === 0 ? "★" : b.rank}</td>
	<td>${esc(b.page_type.replace("_", "/"))}</td>
	<td class="num">${b.word_count}</td>
	<td class="num">${b.h2_count}</td>
	<td>${b.has_faq ? "✓" : "·"}</td>
	<td>${b.has_table ? "✓" : "·"}</td>
	<td>${b.schema_types.length ? "✓" : "·"}</td>
	<td><span class="url">${esc(url)}</span></td>
</tr>`;
		})
		.join("");
	const llm = d.llm;
	const aiPatterns =
		llm && (llm.rankingPatternSummary || llm.top3Differentiators.length)
			? `${llm.rankingPatternSummary ? `<p class="muted">${md(llm.rankingPatternSummary)}</p>` : ""}${list("Top differentiators", llm.top3Differentiators)}`
			: "";
	return `
<div class="section">
	<h2>1 · Competitor Analysis</h2>
	<table>
		<thead><tr><th class="num">#</th><th>Type</th><th class="num">Words</th><th class="num">H2</th><th>FAQ</th><th>Table</th><th>Schema</th><th>Exact URL</th></tr></thead>
		<tbody>${rows}</tbody>
	</table>
	<p class="meta">★ = your page.</p>
	${aiPatterns}
</div>`;
}

function list(title: string, items: string[]): string {
	if (!items.length) return "";
	return `<h3>${esc(title)}</h3><ul>${items.map(x => `<li>${md(x)}</li>`).join("")}</ul>`;
}

function aiSection(d: ExportInput): string {
	const llm = d.llm;
	if (!llm) return "";
	const plan = llm.priorityActionPlan;
	return `
<div class="section" style="break-inside:auto">
	<h2>3 · Page Gap Analysis — opportunities & action plan</h2>
	${list("Opportunities to own", llm.opportunityHighlights)}
	${list("Sourced recommendations", llm.sourcedRecommendations)}
	<div class="grid2">
		<div>${list("Critical", plan.critical)}${list("Quick wins", plan.quickWins)}</div>
		<div>${list("Medium fixes", plan.mediumFixes)}${list("Strategic rewrites", plan.strategicRewrites)}</div>
	</div>
	${list("Content quality", llm.contentQualityFindings)}
	${list("GEO / AI readiness", llm.geoFindings)}
	${llm.confidenceNotes ? `<p class="meta">${md(llm.confidenceNotes)}</p>` : ""}
</div>`;
}

function promptSection(d: ExportInput): string {
	const pf = d.llm?.promptFinder ?? d.report.promptFinder;
	if (!pf) return "";
	const prompts = pf.prompts
		.map(
			p => `<div class="gap" style="border:0;padding:4px 0">
	<div><span class="sev" style="background:${p.readiness === "ready" ? GREEN_MED : p.readiness === "partial" ? SEV.medium : SEV.critical}">${p.intent.toUpperCase()} · ${p.readiness}</span>“${esc(p.prompt)}”</div>
	${p.rationale ? `<div class="ev">${esc(p.rationale)}</div>` : ""}
	${p.alignmentActions.length ? `<ul>${p.alignmentActions.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
</div>`,
		)
		.join("");
	return `
<div class="section" style="break-inside:auto">
	<h2>4 · Prompts For GEO Mentions & Citation</h2>
	<p class="kv"><b>Industry:</b> ${esc(pf.industry)} (${pf.industryConfidence}%${pf.isYmyl ? " · YMYL" : ""}) · <b>Niche:</b> ${esc(pf.niche)} · <b>Audience:</b> ${esc(pf.audience)}</p>
	<p class="muted">${esc(pf.relevanceNotes)}</p>
	<h3>Prompts to align this page to</h3>
	${prompts}
</div>`;
}

function schemaSection(d: ExportInput): string {
	const schema = d.schema;
	if (!schema?.jsonld.length) return "";
	return `
<div class="section" style="break-inside:auto">
	<h2>5 · Schema Generator (JSON-LD)</h2>
	<p class="kv"><b>Final types:</b> ${esc(schema.types.join(", ") || "—")}</p>
	${schema.addedTypes?.length ? `<p class="kv"><b>Added:</b> ${esc(schema.addedTypes.join(", "))}</p>` : ""}
	<div class="code">${esc(schemaScriptTag(schema.jsonld))}</div>
</div>`;
}

/** 6 · Target Artifacts — heading blueprint, schema set, unique items, links. */
function artifactsSection(d: ExportInput): string {
	const { report, llm } = d;
	const blueprint = llm?.headingBlueprint.length
		? `<h3>a · Recommended heading structure</h3>${llm.headingBlueprint
				.map(
					h =>
						`<div class="kv" style="padding-left:${(h.level - 1) * 16}px"><b>H${h.level}</b> <span class="muted">[${h.status}]</span> ${esc(h.text)}${h.note ? ` — ${esc(h.note)}` : ""}</div>`,
				)
				.join("")}`
		: "";
	const schemaSet = `<h3>b · Schema set</h3>
	<p class="kv"><b>On the page:</b> ${esc(report.target.schemaTypes.join(", ") || "none")}</p>
	${d.schema?.types.length ? `<p class="kv"><b>Recommended set:</b> ${esc(d.schema.types.join(", "))}</p>` : ""}`;
	const unique = buildUniqueItems(report);
	const uniqueBlock = unique.length
		? `<h3>d · Unique items across ranking pages</h3><ul>${unique
				.map(u => `<li><b>${esc(u.item)}</b> — on ${esc(u.presentOn.join(", "))}. ${esc(u.note)}</li>`)
				.join("")}</ul>`
		: "";
	const links = report.target.links.length
		? `<h3>c · Links on the target page (${report.target.links.length})</h3><ul>${report.target.links
				.map(l => `<li>[${esc(l.kind)}] ${esc(l.text || "—")} — <span class="url">${esc(l.url)}</span></li>`)
				.join("")}</ul>`
		: "";
	return `<div class="section" style="break-inside:auto"><h2>6 · Target Artifacts</h2>${blueprint}${schemaSet}${uniqueBlock}${links}</div>`;
}

export function buildReportHtml(d: ExportInput): string {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>SEO Page Gap Report</title><style>${styles()}</style></head>
<body>
${coverSection(d)}
${benchmarkSection(d)}
${intentSection(d)}
${findingsSection(d)}
${aiSection(d)}
${promptSection(d)}
${schemaSection(d)}
${artifactsSection(d)}
</body></html>`;
}
