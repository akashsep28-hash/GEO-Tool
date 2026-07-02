/**
 * Pure export builders for Page Gap Analyzer reports (JSON, Markdown, CSV).
 * No server-only imports — safe to use in a client component for downloads.
 */

import { buildUniqueItems } from "@/lib/page-gap-artifacts";
import type { Gap } from "@/lib/page-gap-engine";
import type { PageGapLlm } from "@/lib/page-gap-llm";
import type { PageGapResult } from "@/lib/page-gap-run";
import type { SchemaResult } from "@/lib/page-gap-schema";

export type ExportInput = {
	report: PageGapResult;
	llm: PageGapLlm | null;
	schema?: SchemaResult | null;
};

/**
 * Serialize JSON-LD into a ready-to-paste <script> tag. Client-safe (no
 * server-only deps) so the report UI and the exporters share ONE implementation.
 * Every "<" is escaped to its < JSON escape — this keeps the JSON valid
 * while guaranteeing a "</script>" inside a string can never close the tag
 * early (the classic JSON-LD-in-HTML XSS/breakage guardrail).
 */
export function schemaScriptTag(jsonld: Record<string, unknown>[]): string {
	const body = jsonld.length === 1 ? jsonld[0] : jsonld;
	const json = JSON.stringify(body, null, 2).replace(/</g, "\\u003c");
	return `<script type="application/ld+json">\n${json}\n</script>`;
}

/** Full report as JSON (the heavy rendered-HTML blobs are replaced with sizes). */
export function toJson({ report, llm, schema }: ExportInput): string {
	const slim: PageGapResult = {
		...report,
		target: { ...report.target, html: `[${report.target.htmlBytes} bytes omitted]` },
		competitors: report.competitors.map(c => ({
			...c,
			html: `[${c.htmlBytes} bytes omitted — use the HTML ZIP download]`,
		})),
	};
	return JSON.stringify({ report: slim, llm, schema: schema ?? null }, null, 2);
}

// ---------------------------------------------------------------------------
// Bulk HTML download — a real ZIP archive (STORE / no compression) of every
// parsed page, built in pure JS so no dependency is needed and it runs in the
// browser. One .html file per page + a manifest, so the user can do further
// analysis outside the app.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function leBytes(n: number, bytes: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < bytes; i++) out.push((n >>> (i * 8)) & 0xff);
	return out;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
	const enc = new TextEncoder();
	// Collect Uint8Array segments and concatenate once at the end. We must NOT
	// spread large byte arrays into Array.prototype.push (`push(...bytes)`): each
	// byte becomes a function argument and engines cap that at ~65k, so any file
	// bigger than that throws "Maximum call stack size exceeded".
	const localSegs: Uint8Array[] = [];
	const centralSegs: Uint8Array[] = [];
	let offset = 0; // running byte length of all local segments

	for (const f of files) {
		const nameBytes = enc.encode(f.name);
		const crc = crc32(f.data);
		const size = f.data.length;

		// Local file header
		const local = Uint8Array.from([
			...leBytes(0x04034b50, 4),
			...leBytes(20, 2), // version needed
			...leBytes(0, 2), // flags
			...leBytes(0, 2), // method 0 = store
			...leBytes(0, 2), // mod time
			...leBytes(0, 2), // mod date
			...leBytes(crc, 4),
			...leBytes(size, 4),
			...leBytes(size, 4),
			...leBytes(nameBytes.length, 2),
			...leBytes(0, 2), // extra len
			...Array.from(nameBytes),
		]);
		localSegs.push(local, f.data);

		// Central directory record
		centralSegs.push(
			Uint8Array.from([
				...leBytes(0x02014b50, 4),
				...leBytes(20, 2), // version made by
				...leBytes(20, 2), // version needed
				...leBytes(0, 2),
				...leBytes(0, 2),
				...leBytes(0, 2),
				...leBytes(0, 2),
				...leBytes(crc, 4),
				...leBytes(size, 4),
				...leBytes(size, 4),
				...leBytes(nameBytes.length, 2),
				...leBytes(0, 2),
				...leBytes(0, 2),
				...leBytes(0, 2),
				...leBytes(0, 2),
				...leBytes(0, 4),
				...leBytes(offset, 4),
				...Array.from(nameBytes),
			]),
		);
		offset += local.length + size;
	}

	const centralOffset = offset; // bytes before the central directory
	const centralSize = centralSegs.reduce((n, s) => n + s.length, 0);
	const end = Uint8Array.from([
		...leBytes(0x06054b50, 4),
		...leBytes(0, 2),
		...leBytes(0, 2),
		...leBytes(files.length, 2),
		...leBytes(files.length, 2),
		...leBytes(centralSize, 4),
		...leBytes(centralOffset, 4),
		...leBytes(0, 2),
	]);

	// Single allocation + copy — no per-byte spreads.
	const all = [...localSegs, ...centralSegs, end];
	const totalLen = all.reduce((n, s) => n + s.length, 0);
	const out = new Uint8Array(totalLen);
	let pos = 0;
	for (const s of all) {
		out.set(s, pos);
		pos += s.length;
	}
	return out;
}

function safeName(s: string): string {
	return (s || "page")
		.replace(/[^a-z0-9.-]+/gi, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

/** Build a ZIP of all parsed page HTML (target + competitors) + a manifest. */
export function buildHtmlZip(report: PageGapResult): Uint8Array {
	const enc = new TextEncoder();
	const files: { name: string; data: Uint8Array }[] = [];
	const manifest: string[] = [
		`Page Gap HTML bundle`,
		`Keyword: ${report.keyword}`,
		`Run: ${report.fetchedAt} · ${report.country}/${report.device}`,
		``,
		`file\trank\tdomain\tpage_type\twords\turl`,
	];

	if (report.target?.html) {
		const name = `00-target-${safeName(report.target.domain)}.html`;
		files.push({ name, data: enc.encode(report.target.html) });
		manifest.push(
			`${name}\t0\t${report.target.domain}\t${report.target.features.pageType}\t${report.target.wordCount}\t${report.target.finalUrl}`,
		);
	}
	for (const c of report.competitors) {
		if (!c.html) continue;
		const name = `${String(c.rank).padStart(2, "0")}-${safeName(c.domain)}.html`;
		files.push({ name, data: enc.encode(c.html) });
		manifest.push(`${name}\t${c.rank}\t${c.domain}\t${c.features.pageType}\t${c.wordCount}\t${c.finalUrl}`);
	}
	files.push({ name: "MANIFEST.txt", data: enc.encode(manifest.join("\n")) });
	return zipStore(files);
}

function bulletList(items: string[]): string {
	return items.length ? items.map(i => `- ${i}`).join("\n") : "_None_";
}

export function toMarkdown({ report, llm, schema }: ExportInput): string {
	const i = report.intent;
	const lines: string[] = [];
	lines.push(`# Page Gap Analysis — ${report.keyword}`);
	lines.push("");
	lines.push(`**Target:** ${report.targetUrl}`);
	lines.push(`**Run:** ${report.fetchedAt} · ${report.country}/${report.device}`);
	lines.push(`**${report.sopScorecard ? "SOP score" : "Composite score"}:** ${report.score}/100`);
	lines.push("");
	// 1 — Competitor Analysis (benchmark + ranking patterns)
	lines.push("## 1. Competitor Analysis");
	lines.push(
		"| rank | domain | type | words | h2 | faq | table | calc | cta | author | date | svc-link | answer-first |",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
	for (const b of report.benchmark) {
		lines.push(
			`| ${b.rank} | ${b.domain} | ${b.page_type} | ${b.word_count} | ${b.h2_count} | ${b.has_faq ? "✓" : ""} | ${b.has_table ? "✓" : ""} | ${b.has_calculator ? "✓" : ""} | ${b.has_inline_cta ? "✓" : ""} | ${b.has_named_author ? "✓" : ""} | ${b.has_updated_date ? "✓" : ""} | ${b.internal_link_to_service ? "✓" : ""} | ${b.geo_answer_first ? "✓" : ""} |`,
		);
	}
	lines.push("");
	if (llm?.rankingPatternSummary) {
		lines.push(llm.rankingPatternSummary);
		lines.push("");
	}
	if (llm?.top3Differentiators.length) {
		lines.push("### Top differentiators");
		lines.push(bulletList(llm.top3Differentiators));
		lines.push("");
	}

	// 2 — SERP Intent Analysis
	lines.push("## 2. SERP Intent Analysis");
	lines.push(`- Verdict: **${i.verdict}** — ${i.verdictLabel}`);
	lines.push(`- Rule applied: ${i.ruleApplied}`);
	lines.push(`- Target page type: ${i.targetPageType}`);
	lines.push(`- Mismatch: ${i.mismatch ? "**YES (critical)**" : "no"}`);
	lines.push(
		`- SERP composition: product/service ${i.composition.commercial}, blog/guide ${i.composition.informational}, hybrid ${i.composition.hybrid}, comparison ${i.composition.comparison} (of ${i.composition.total})`,
	);
	lines.push(`- ${i.reason}`);
	if (llm?.intentVerdictNarrative) {
		lines.push("");
		lines.push(llm.intentVerdictNarrative);
	}
	lines.push("");

	// 3 — Page Gap Analysis (scorecard + opportunities + action plan, consolidated)
	lines.push("## 3. Page Gap Analysis");
	if (report.sopScorecard) {
		const sc = report.sopScorecard;
		const rank = (s: string) => (s === "fail" ? 0 : s === "partial" ? 1 : 2);
		lines.push(`SOP score ${sc.overall}/100 (Technical · On-Page · GEO). Fix the flagged items top-down.`);
		lines.push("");
		for (const cat of sc.categories) {
			const items = [...cat.items].sort((a, b) => rank(a.status) - rank(b.status) || b.weight - a.weight);
			lines.push(`### ${cat.label} — ${cat.score}/100`);
			lines.push("| status | SOP | wt | action item | detail | fix | SERP |");
			lines.push("|---|---|---|---|---|---|---|");
			for (const it of items) {
				const prev = it.serpPrevalence ? `${it.serpPrevalence.pass}/${it.serpPrevalence.total}` : "—";
				const fix =
					it.status === "pass" || it.status === "not_applicable" ? "—" : it.recommendation.replace(/\|/g, "/");
				lines.push(
					`| ${it.status} | r${it.sopRow} | ${it.weight} | ${it.title} | ${it.detail.replace(/\|/g, "/")} | ${fix} | ${prev} |`,
				);
			}
			lines.push("");
		}
	} else {
		for (const g of report.gaps) {
			lines.push(`### [${g.severity.toUpperCase()}] ${g.title}`);
			lines.push(
				`- Prevalence: ${g.serp_prevalence}${g.serp_validated ? " (SERP-validated)" : " (best practice — not SERP-validated)"}`,
			);
			lines.push(`- Why it matters: ${g.why_it_matters}`);
			lines.push(`- Recommended action: ${g.recommended_action}`);
			if (g.suggested_fix) lines.push(`- Suggested fix: ${g.suggested_fix}`);
			if (g.serp_evidence.length) {
				lines.push(`- Evidence:`);
				for (const e of g.serp_evidence) lines.push(`  - rank ${e.rank} ${e.domain}: ${e.example_value}`);
			}
			lines.push("");
		}
	}
	if (llm) {
		if (llm.opportunityHighlights.length) {
			lines.push("### Opportunities to own");
			lines.push(bulletList(llm.opportunityHighlights));
			lines.push("");
		}
		lines.push("### Prioritised action plan");
		lines.push("**Critical**");
		lines.push(bulletList(llm.priorityActionPlan.critical));
		lines.push("**Quick wins**");
		lines.push(bulletList(llm.priorityActionPlan.quickWins));
		lines.push("**Medium fixes**");
		lines.push(bulletList(llm.priorityActionPlan.mediumFixes));
		lines.push("**Strategic rewrites**");
		lines.push(bulletList(llm.priorityActionPlan.strategicRewrites));
		if (llm.contentQualityFindings.length) {
			lines.push("### Content quality");
			lines.push(bulletList(llm.contentQualityFindings));
		}
		if (llm.geoFindings.length) {
			lines.push("### GEO / AI readiness");
			lines.push(bulletList(llm.geoFindings));
		}
		if (llm.sourcedRecommendations.length) {
			lines.push("### SERP-sourced recommendations");
			lines.push(bulletList(llm.sourcedRecommendations));
		}
		if (llm.confidenceNotes) {
			lines.push("");
			lines.push(`_${llm.confidenceNotes}_`);
		}
		lines.push("");
	}

	const pf = llm?.promptFinder ?? report.promptFinder;
	if (pf) {
		lines.push("");
		lines.push("## 4. Prompts For GEO Mentions & Citation");
		lines.push(`- **Industry:** ${pf.industry} (${pf.industryConfidence}% confidence${pf.isYmyl ? " · YMYL" : ""})`);
		lines.push(`- **Niche:** ${pf.niche}`);
		lines.push(`- **Topic:** ${pf.topic}`);
		lines.push(`- **Primary intent:** ${pf.primaryIntent}`);
		lines.push(`- **Audience:** ${pf.audience}`);
		lines.push(`- **Source:** ${pf.source === "ai" ? `AI (${pf.model ?? "model"})` : "Deterministic baseline"}`);
		lines.push(`- ${pf.relevanceNotes}`);
		lines.push("");
		lines.push("### Prompts to align this page to");
		for (const p of pf.prompts) {
			lines.push(`- **[${p.intent} · ${p.readiness}]** "${p.prompt}" — _${p.platforms.join(", ")}_`);
			if (p.rationale) lines.push(`  - ${p.rationale}`);
			for (const a of p.alignmentActions) lines.push(`  - ▸ ${a}`);
		}
		if (pf.geoOptimizationItems.length) {
			lines.push("");
			lines.push("### GEO items to update");
			for (const it of pf.geoOptimizationItems) {
				lines.push(`- **[${it.priority}]** ${it.item}`);
				if (it.prompts.length) lines.push(`  - Unlocks: ${it.prompts.map(q => `"${q}"`).join(", ")}`);
			}
		}
	}

	if (schema?.jsonld.length) {
		lines.push("");
		lines.push("## 5. Schema Generator (JSON-LD)");
		lines.push(
			`- **Source:** ${schema.source === "ai" ? `AI (${schema.model ?? "model"})` : "Deterministic skeleton"}`,
		);
		lines.push(`- **Existing (preserved):** ${(schema.existingTypes ?? []).join(", ") || "none"}`);
		lines.push(`- **Added:** ${(schema.addedTypes ?? []).join(", ") || "none"}`);
		lines.push(`- **Final types:** ${schema.types.join(", ") || "—"}`);
		if (schema.competitorSchemaTypes.length)
			lines.push(
				`- **Schema across ranking pages:** ${schema.competitorSchemaTypes.map(c => `${c.type} (${c.count}/${c.total})`).join(", ")}`,
			);
		if (schema.gapSignals?.length) lines.push(`- **Driven by gaps:** ${schema.gapSignals.join("; ")}`);
		if (schema.faqFromPrompts?.length)
			lines.push(`- **GEO prompts added to FAQ:** ${schema.faqFromPrompts.map(q => `“${q}”`).join(", ")}`);
		if (schema.rationale) lines.push(`- ${schema.rationale}`);
		for (const w of schema.warnings) lines.push(`- ⚠ ${w}`);
		lines.push("");
		lines.push("```html");
		lines.push(schemaScriptTag(schema.jsonld));
		lines.push("```");
	}

	// 6 — Target Artifacts
	lines.push("");
	lines.push("## 6. Target Artifacts");
	if (llm?.headingBlueprint.length) {
		lines.push("### a · Recommended heading structure");
		for (const h of llm.headingBlueprint) {
			const indent = h.level === 1 ? "" : h.level === 2 ? "  " : "    ";
			lines.push(`${indent}- **H${h.level}** [${h.status}] ${h.text}${h.note ? ` — ${h.note}` : ""}`);
		}
		lines.push("");
	}
	lines.push("### b · Schema set");
	lines.push(`- On the page: ${report.target.schemaTypes.join(", ") || "none"}`);
	if (schema?.types.length) lines.push(`- Recommended set: ${schema.types.join(", ")}`);
	lines.push("");
	const uniqueItems = buildUniqueItems(report);
	if (uniqueItems.length) {
		lines.push("### d · Unique items across ranking pages");
		for (const u of uniqueItems) lines.push(`- **${u.item}** — on ${u.presentOn.join(", ")}. ${u.note}`);
		lines.push("");
	}
	lines.push("### c · Links on the target page");
	lines.push(`${report.target.links.length} link(s) parsed.`);
	for (const l of report.target.links) lines.push(`- [${l.kind}] ${l.text || "—"} → ${l.url}`);

	return lines.join("\n");
}

function csvCell(value: unknown): string {
	const s = String(value ?? "");
	return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv({ report }: ExportInput): string {
	const header = [
		"id",
		"severity",
		"dimension",
		"category",
		"serp_validated",
		"serp_prevalence",
		"title",
		"why_it_matters",
		"recommended_action",
		"evidence",
	];
	const rows = report.gaps.map((g: Gap) =>
		[
			g.id,
			g.severity,
			g.dimension,
			g.category,
			g.serp_validated,
			g.serp_prevalence,
			g.title,
			g.why_it_matters,
			g.recommended_action,
			g.serp_evidence.map(e => `rank ${e.rank} ${e.domain}: ${e.example_value}`).join(" | "),
		]
			.map(csvCell)
			.join(","),
	);
	return [header.map(csvCell).join(","), ...rows].join("\n");
}
