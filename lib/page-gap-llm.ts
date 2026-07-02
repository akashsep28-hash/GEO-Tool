/**
 * Page Gap Analyzer — LLM narrative layer (per-section).
 *
 * Instead of one heavy generateText call, the analysis is split into five
 * section-scoped functions, each its own focused prompt:
 *   1. analyzeCompetitorSection  → ranking-pattern + differentiators (§1)
 *   2. analyzeIntentSection      → intent verdict narrative (§2)
 *   3. analyzePageGapSection     → findings + gap fixes + action plan (§3)
 *   4. analyzePromptsSection     → refined GEO Prompt Finder (§4)
 *   5. analyzeStructureSection   → heading blueprint for the target (§6 artifact)
 *
 * Each call carries only the context that section needs, so per-prompt load is
 * far lower. The streaming route (app/api/page-gap/[id]/analyze) runs them in
 * sequence and persists partial output as it goes. analyzePageGapWithAi() keeps
 * the old "all at once" behaviour for the server-action fallback.
 *
 * Reuses the existing provider-agnostic generateText() — no new LLM integration.
 */
import "server-only";
import { runAgent } from "@/lib/agent-runner";
import { aiAvailability } from "@/lib/ai";
import type { Gap } from "@/lib/page-gap-engine";
import type { PageGapResult } from "@/lib/page-gap-run";
import type {
	GeoOptimizationItem,
	GeoPrompt,
	PromptFinderResult,
	PromptIntent,
	PromptReadiness,
} from "@/lib/prompt-finder";

export type PriorityActionPlan = {
	critical: string[];
	quickWins: string[];
	mediumFixes: string[];
	strategicRewrites: string[];
};

/** One line of the recommended heading outline for the target page. */
export type HeadingBlueprintItem = {
	level: 1 | 2 | 3;
	text: string;
	/** What to put under this heading / why it's needed. */
	note: string;
	status: "keep" | "add" | "improve";
};

export type PageGapLlm = {
	intentVerdictNarrative: string;
	rankingPatternSummary: string;
	top3Differentiators: string[];
	contentQualityFindings: string[];
	geoFindings: string[];
	opportunityHighlights: string[];
	sourcedRecommendations: string[];
	/** Per-gap concrete fixes, keyed by gap id, merged inline into each finding. */
	gapFixes: Record<string, string>;
	/** AI-refined GEO Prompt Finder (industry/niche/intent + prompt bank + GEO map). */
	promptFinder: PromptFinderResult | null;
	priorityActionPlan: PriorityActionPlan;
	confidenceNotes: string;
	/** Recommended hierarchical heading outline for the target page (§6 artifact a). */
	headingBlueprint: HeadingBlueprintItem[];
	model: string;
	generatedAt: string;
};

const SYSTEM = `You are a senior Generative Engine Optimization (GEO) + SEO strategist. You analyse ONE target page against the live top-10 Google SERP for ONE keyword and explain, in concrete, sourced, decision-ready language, exactly why it does or does not compete — and precisely what to change.

DURABLE RULES (always, without exception):
1. SERP-first, never assumption-first. The format and patterns Google already rewards in the visible top 10 define what the page must become. Do not argue from generic "best practice" when the SERP evidence says otherwise.
2. Intent match overrides everything. A structurally perfect page in the wrong format (blog where a service page ranks, or vice-versa) cannot win. Lead with this when it applies.
3. Evidence or silence. Every claim about competitors must trace to the benchmark/gap data you were given (rank, domain, value). NEVER invent competitor facts, numbers, schema, or features. If the data does not support a point, do not make it.
4. Be specific and domain-aware. Not "add an FAQ" — "add an FAQ answering [the actual questions ranking pages #2 and #5 use], because…". Name the competing domains/ranks that justify each fix.
5. Quantify. When you recommend depth, sections, data, or schema, anchor to the actual ranking medians/values in the data (e.g. "competitors run ~1,800 words and 9 H2s; you have 600 and 3").
6. Prioritise by buyer value × SERP evidence × effort, not by checklist order.
7. Tie GEO recommendations to extractability: answer-first passages, question-led headings, tables, named entities, and schema that answer engines lift.
8. Honesty about confidence. If pages failed to render or the SERP looks mixed/ambiguous, say so and lower your certainty.

OUTPUT FORMATTING:
- Use plain prose and simple bullets only. ONE bullet per line, starting with "- ".
- You MAY use **bold** for key terms (it renders correctly). Do NOT use markdown headings (#), markdown tables, or nested bullets.
- Always close **bold** you open. Never emit stray or unbalanced ** markers.
- No filler, no restating the prompt, no empty persuasive language.
- Output NOTHING outside the delimited sections you are asked for.`;

// ---------------------------------------------------------------------------
// Shared context builders (sliced per section to keep each prompt light).
// ---------------------------------------------------------------------------

function gapLine(g: Gap): string {
	const ev = g.serp_evidence.map(e => `rank ${e.rank} ${e.domain}: ${e.example_value}`).join(" | ");
	return `[${g.severity}] ${g.id} — ${g.title}${ev ? ` || evidence: ${ev}` : ""}`;
}

function med(nums: number[]): number {
	const s = nums.filter(n => n >= 0).sort((a, b) => a - b);
	if (!s.length) return 0;
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Small shared header every section gets (keyword, intent verdict, target signals). */
function coreContext(r: PageGapResult): string {
	const t = r.target.features;
	const comp = r.intent.composition;
	const compRows = r.benchmark.filter(b => b.rank > 0);
	const medWords = med(compRows.map(b => b.word_count));
	const medH2 = med(compRows.map(b => b.h2_count));
	return `KEYWORD: ${r.keyword}
TARGET URL: ${r.targetUrl}
COUNTRY/DEVICE: ${r.country} / ${r.device}

INTENT VERDICT (deterministic):
- Rule applied: ${r.intent.ruleApplied}
- Verdict: ${r.intent.verdict} (${r.intent.verdictLabel})
- Target page type: ${r.intent.targetPageType} (classifier confidence ${t.pageTypeScore?.confidence ?? "?"}/100; commercial ${t.pageTypeScore?.commercial ?? "?"}, informational ${t.pageTypeScore?.informational ?? "?"})
- Mismatch: ${r.intent.mismatch}
- Action modifiers: ${r.intent.actionModifiers.join(", ") || "none"}
- SERP composition: product/service ${comp.commercial}, blog/guide ${comp.informational}, hybrid ${comp.hybrid}, comparison ${comp.comparison} (of ${comp.total} classified)
- Ranking medians: ${medWords} words, ${medH2} H2 sections
- Reason: ${r.intent.reason}

TARGET PAGE SIGNALS:
- Title: ${t.title || "(none)"} (${t.titleLength} chars)
- Words: ${t.wordCount} | H2: ${t.h2Count} | question headings: ${t.questionHeadings}
- FAQ: ${t.hasFaq} | tables: ${t.tableCount} | stats: ${t.statMatches}
- Author: ${t.hasAuthorSignal} | date: ${t.hasDateSignal} | schema: ${t.schemaTypes.join(", ") || "none"}
- Conversion: inline CTA ${t.conv.hasInlineCta}, sticky CTA ${t.conv.hasStickyCta}, calculator ${t.conv.hasCalculator}, weak CTA ${t.conv.ctaWeak}
- Internal link to service page: ${t.hasServiceInternalLink}
- Answer-first: ${t.hasAnswerFirst} | composite score: ${r.score}/100`;
}

function benchmarkBlock(r: PageGapResult): string {
	const rows = r.benchmark
		.map(
			b =>
				`${b.rank === 0 ? "TARGET" : `#${b.rank}`} ${b.domain} | ${b.page_type} | ${b.word_count}w | h2:${b.h2_count} | faq:${b.has_faq} | table:${b.has_table} | calc:${b.has_calculator} | cta:${b.has_inline_cta} | author:${b.has_named_author} | date:${b.has_updated_date} | schema:[${b.schema_types.slice(0, 5).join(",")}] | svc-link:${b.internal_link_to_service} | answer-first:${b.geo_answer_first} | q-headings:${b.geo_question_headings}`,
		)
		.join("\n");
	return `BENCHMARK (rank 0 = target):\n${rows}`;
}

function gapsBlock(r: PageGapResult): string {
	const allGapIds = [...r.serpValidatedGaps, ...r.lowConfidenceGaps].map(g => g.id);
	return `SERP-VALIDATED GAPS (3+ ranking pages prove these):
${r.serpValidatedGaps.map(gapLine).join("\n") || "(none)"}

LOW-CONFIDENCE / NOT-YET-VALIDATED:
${r.lowConfidenceGaps.map(gapLine).join("\n") || "(none)"}

ALL GAP IDS (produce one fix line for EVERY id in ===GAP_FIXES===):
${allGapIds.join(", ") || "(none)"}`;
}

function promptBaselineBlock(r: PageGapResult): string {
	return `DETERMINISTIC PROMPT-FINDER BASELINE (refine this — keep what is right, fix what is wrong, add what is missing):
- Industry: ${r.promptFinder.industry} (confidence ${r.promptFinder.industryConfidence}) | YMYL: ${r.promptFinder.isYmyl}
- Niche: ${r.promptFinder.niche} | Topic: ${r.promptFinder.topic} | Audience: ${r.promptFinder.audience}
- Candidate prompts: ${r.promptFinder.prompts.map(p => `"${p.prompt}" [${p.intent}/${p.readiness}]`).join(" ; ")}`;
}

function headingsBlock(r: PageGapResult): string {
	const h = r.target.headings;
	return `TARGET PAGE CURRENT HEADINGS:
${h.h1.map(x => `H1: ${x}`).join("\n") || "(no H1)"}
${h.h2.map(x => `H2: ${x}`).join("\n") || "(no H2)"}
${h.h3.map(x => `H3: ${x}`).join("\n") || "(no H3)"}`;
}

// ---------------------------------------------------------------------------
// Parsers (shared with the old single-call format).
// ---------------------------------------------------------------------------

function sliceSection(raw: string, start: string, end: string): string {
	const startIdx = raw.indexOf(start);
	if (startIdx === -1) return "";
	const from = startIdx + start.length;
	const endIdx = raw.indexOf(end, from);
	return raw.slice(from, endIdx === -1 ? undefined : endIdx).trim();
}

function toBullets(block: string): string[] {
	return block
		.split(/\r?\n/)
		.map(l => l.replace(/^[-*•]\s*/, "").trim())
		.filter(l => l.length > 0 && !/^={3,}/.test(l));
}

function parseGapFixes(block: string): Record<string, string> {
	const fixes: Record<string, string> = {};
	for (const line of block.split(/\r?\n/)) {
		const cleaned = line.replace(/^[-*•]\s*/, "").trim();
		if (!cleaned || /^={3,}/.test(cleaned)) continue;
		const idx = cleaned.indexOf("::");
		if (idx === -1) continue;
		const id = cleaned
			.slice(0, idx)
			.trim()
			.replace(/^["'`]|["'`]$/g, "");
		const fix = cleaned.slice(idx + 2).trim();
		if (id && fix) fixes[id] = fix;
	}
	return fixes;
}

const VALID_INTENT: PromptIntent[] = ["informational", "comparison", "commercial", "transactional", "local"];
const VALID_READINESS: PromptReadiness[] = ["ready", "partial", "missing"];

/** Parse + validate the PROMPT_FINDER JSON section, merged over the baseline. */
function parsePromptFinder(raw: string, baseline: PromptFinderResult, model: string): PromptFinderResult {
	const block = sliceSection(raw, "===PROMPT_FINDER===", "===END===");
	const match = block.match(/\{[\s\S]*\}/);
	if (!match) return baseline;
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(match[0]) as Record<string, unknown>;
	} catch {
		return baseline;
	}

	const str = (v: unknown, fb: string) => (typeof v === "string" && v.trim() ? v.trim() : fb);
	const arrStr = (v: unknown): string[] =>
		Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

	const rawPrompts = Array.isArray(json.prompts) ? json.prompts : [];
	const prompts: GeoPrompt[] = rawPrompts
		.map((p): GeoPrompt | null => {
			if (!p || typeof p !== "object") return null;
			const o = p as Record<string, unknown>;
			const prompt = str(o.prompt, "");
			if (!prompt) return null;
			const intent = (VALID_INTENT as string[]).includes(String(o.intent))
				? (o.intent as PromptIntent)
				: "informational";
			const alignmentActions = arrStr(o.alignmentActions);
			const readiness = (VALID_READINESS as string[]).includes(String(o.readiness))
				? (o.readiness as PromptReadiness)
				: alignmentActions.length === 0
					? "ready"
					: alignmentActions.length === 1
						? "partial"
						: "missing";
			const platforms = arrStr(o.platforms);
			return {
				prompt,
				intent,
				platforms: platforms.length ? platforms : ["ChatGPT", "Perplexity", "Google AI Overviews"],
				rationale: str(o.rationale, ""),
				readiness,
				alignmentActions,
			};
		})
		.filter((p): p is GeoPrompt => p !== null);

	const rawItems = Array.isArray(json.geoOptimizationItems) ? json.geoOptimizationItems : [];
	const geoOptimizationItems: GeoOptimizationItem[] = rawItems
		.map((it): GeoOptimizationItem | null => {
			if (!it || typeof it !== "object") return null;
			const o = it as Record<string, unknown>;
			const item = str(o.item, "");
			if (!item) return null;
			const priority = ["critical", "high", "medium", "low"].includes(String(o.priority))
				? (o.priority as GeoOptimizationItem["priority"])
				: "medium";
			return { item, why: str(o.why, ""), priority, prompts: arrStr(o.prompts) };
		})
		.filter((x): x is GeoOptimizationItem => x !== null);

	return {
		...baseline,
		industry: str(json.industry, baseline.industry),
		niche: str(json.niche, baseline.niche),
		topic: str(json.topic, baseline.topic),
		audience: str(json.audience, baseline.audience),
		prompts: prompts.length ? prompts : baseline.prompts,
		geoOptimizationItems: geoOptimizationItems.length ? geoOptimizationItems : baseline.geoOptimizationItems,
		source: "ai",
		model,
		generatedAt: new Date().toISOString(),
	};
}

const HEADING_LEVEL_RE = /^h\s*([123])\b/i;
const HEADING_STATUS_RE = /\b(keep|improve|add)\b/i;

/**
 * Split a heading line's "text :: note" tail. Prefer the canonical "::"; only
 * fall back to an em-dash / " - " when no "::" is present, so a title that
 * legitimately contains a dash is not cut in half.
 */
function splitHeadingTextNote(rest: string): { text: string; note: string } {
	const clean = rest.trim();
	const sepRe = clean.includes("::") ? /\s*::\s*/ : /\s*(?:—|–|\s-\s)\s*/;
	const sepMatch = clean.match(sepRe);
	if (!sepMatch || sepMatch.index === undefined) {
		return { text: clean.replace(/^["'`]|["'`]$/g, ""), note: "" };
	}
	const text = clean
		.slice(0, sepMatch.index)
		.trim()
		.replace(/^["'`]|["'`]$/g, "");
	const note = clean.slice(sepMatch.index + sepMatch[0].length).trim();
	return { text, note };
}

/**
 * Parse the HEADING_BLUEPRINT section. The canonical line is
 * `H2 | add | <text> :: <note>`, but models drift (drop pipes, use an em-dash
 * for the note, prefix bullets/markdown). Parse leniently so a small deviation
 * still yields the outline instead of an empty blueprint.
 */
function parseHeadingBlueprint(block: string): HeadingBlueprintItem[] {
	const items: HeadingBlueprintItem[] = [];
	for (const raw of block.split(/\r?\n/)) {
		const line = raw
			.replace(/^[-*•]\s*/, "")
			.replace(/\*\*/g, "")
			.trim();
		if (!line || /^={3,}/.test(line)) continue;
		// Skip an echoed format/header line rather than parsing it as a heading.
		if (/^(level|<h1)\b/i.test(line)) continue;

		const parts = line.split("|");
		let level: 1 | 2 | 3 = 2;
		let status: HeadingBlueprintItem["status"] = "add";
		let rest: string;

		if (parts.length >= 3) {
			// Canonical pipe-delimited form.
			const levelTok = parts[0].trim().toUpperCase();
			level = levelTok.includes("1") ? 1 : levelTok.includes("3") ? 3 : 2;
			const statusTok = parts[1].trim().toLowerCase();
			status = statusTok === "keep" ? "keep" : statusTok === "improve" ? "improve" : "add";
			rest = parts.slice(2).join("|").trim();
		} else {
			// Drifted form: infer level + status from anywhere in the line.
			const lvlMatch = line.match(HEADING_LEVEL_RE);
			if (!lvlMatch) continue; // not a heading line
			level = (Number(lvlMatch[1]) as 1 | 2 | 3) ?? 2;
			const statMatch = line.match(HEADING_STATUS_RE);
			if (statMatch) {
				const s = statMatch[1].toLowerCase();
				status = s === "keep" ? "keep" : s === "improve" ? "improve" : "add";
			}
			// Strip the level token (and a trailing : or - right after it), and the
			// status word, so only the heading text + note remain.
			rest = line
				.replace(HEADING_LEVEL_RE, "")
				.replace(/^[\s:.\-–—)]+/, "")
				.replace(HEADING_STATUS_RE, "")
				.replace(/^[\s:.\-–—)(]+/, "")
				.trim();
		}

		const { text, note } = splitHeadingTextNote(rest);
		if (!text) continue;
		items.push({ level, text, note, status });
	}
	return items;
}

// ---------------------------------------------------------------------------
// Per-section analysis functions. Each throws if no model is connected.
// ---------------------------------------------------------------------------

async function ensureAi(): Promise<string> {
	const avail = await aiAvailability();
	if (!avail.available) {
		throw new Error(
			"No AI model is connected. Connect a Local LLM, OpenAI, or Anthropic key in Settings — or set ANTHROPIC_API_KEY.",
		);
	}
	return avail.label ?? "ai";
}

export function emptyLlm(model: string): PageGapLlm {
	return {
		intentVerdictNarrative: "",
		rankingPatternSummary: "",
		top3Differentiators: [],
		contentQualityFindings: [],
		geoFindings: [],
		opportunityHighlights: [],
		sourcedRecommendations: [],
		gapFixes: {},
		promptFinder: null,
		priorityActionPlan: { critical: [], quickWins: [], mediumFixes: [], strategicRewrites: [] },
		confidenceNotes: "",
		headingBlueprint: [],
		model,
		generatedAt: new Date().toISOString(),
	};
}

/**
 * Deterministic differentiators: where the top-3 median beats the target on
 * the benchmark's own numbers. Used as the fallback (and the truth anchor)
 * when the model's differentiator list fails validation.
 */
function deterministicDifferentiators(r: PageGapResult): string[] {
	const t = r.benchmark.find(b => b.rank === 0);
	const top3 = r.benchmark.filter(b => b.rank >= 1 && b.rank <= 3);
	if (!t || !top3.length) return [];
	const out: string[] = [];
	const medWords = med(top3.map(b => b.word_count));
	const medH2 = med(top3.map(b => b.h2_count));
	if (medWords > t.word_count * 1.4)
		out.push(
			`Content depth: the top 3 (${top3.map(b => b.domain).join(", ")}) run a median ${medWords} words vs the target's ${t.word_count}.`,
		);
	if (medH2 > t.h2_count * 1.5)
		out.push(`Section coverage: top-3 median ${medH2} H2 sections vs the target's ${t.h2_count}.`);
	const faqCount = top3.filter(b => b.has_faq).length;
	if (faqCount >= 2 && !t.has_faq)
		out.push(`FAQ structure: ${faqCount} of the top 3 carry an FAQ block; the target has none.`);
	const schemaCount = top3.filter(b => b.schema_types.length > 0).length;
	if (schemaCount >= 2 && t.schema_types.length === 0)
		out.push(`Structured data: ${schemaCount} of the top 3 ship JSON-LD; the target ships none.`);
	const afCount = top3.filter(b => b.geo_answer_first).length;
	if (afCount >= 2 && !t.geo_answer_first)
		out.push(`Answer-first openings: ${afCount} of the top 3 open with the direct answer; the target does not.`);
	return out.slice(0, 3);
}

/** §1 Competitor Analysis — ranking pattern + top differentiators. */
export async function analyzeCompetitorSection(r: PageGapResult): Promise<Partial<PageGapLlm>> {
	await ensureAi();
	type Out = { rankingPatternSummary: string; top3Differentiators: string[] };
	const res = await runAgent<Out>({
		name: "competitor-analysis",
		system: SYSTEM,
		prompt: `${coreContext(r)}

${benchmarkBlock(r)}

Respond in EXACTLY these delimited sections, nothing outside them:
===RANKING_PATTERN===
What structural/content/conversion patterns appear in 7+ of the top 10. What only the top 1–3 do that 4–10 do not. Where the target aligns vs diverges. Plain prose.
===TOP_DIFFERENTIATORS===
The 3 things that most separate the leaders from the target (one bullet each, name ranks/domains).
===END===`,
		maxTokens: 1800,
		timeoutMs: 120000,
		parse: raw => {
			const rankingPatternSummary = sliceSection(raw, "===RANKING_PATTERN===", "===TOP_DIFFERENTIATORS===");
			const top3Differentiators = toBullets(sliceSection(raw, "===TOP_DIFFERENTIATORS===", "===END==="));
			if (!rankingPatternSummary && !top3Differentiators.length) return null;
			return { rankingPatternSummary, top3Differentiators };
		},
		validate: v => {
			const problems: string[] = [];
			if (v.rankingPatternSummary.length < 80)
				problems.push("RANKING_PATTERN must be a substantive analysis (several sentences), not a stub.");
			if (v.top3Differentiators.length < 2)
				problems.push("TOP_DIFFERENTIATORS must contain 3 bullets, each naming ranks/domains from the benchmark.");
			return problems;
		},
	});
	if (res.ok) {
		// Backfill a short differentiator list from the benchmark numbers if the
		// model's list was still thin after retry.
		const diffs =
			res.value.top3Differentiators.length >= 2
				? res.value.top3Differentiators
				: [...res.value.top3Differentiators, ...deterministicDifferentiators(r)].slice(0, 3);
		return { rankingPatternSummary: res.value.rankingPatternSummary, top3Differentiators: diffs };
	}
	return { rankingPatternSummary: "", top3Differentiators: deterministicDifferentiators(r) };
}

/** §2 SERP Intent Analysis — verdict narrative. */
export async function analyzeIntentSection(r: PageGapResult): Promise<Partial<PageGapLlm>> {
	await ensureAi();
	const res = await runAgent<string>({
		name: "intent-narrative",
		system: SYSTEM,
		prompt: `${coreContext(r)}

Respond in EXACTLY this delimited section, nothing outside it:
===INTENT_VERDICT===
Explain why the SERP composition leads to this page-type verdict and the rule applied (1–7). If there is a mismatch, state exactly what page type to build instead and what that means structurally. Plain prose.
===END===`,
		maxTokens: 1200,
		timeoutMs: 120000,
		parse: raw => sliceSection(raw, "===INTENT_VERDICT===", "===END===") || null,
		validate: v => (v.length >= 60 ? [] : ["INTENT_VERDICT must be a substantive explanation, not a one-liner."]),
	});
	// The deterministic engine's own reason is always a correct (if terse) fallback.
	return { intentVerdictNarrative: res.ok ? res.value : r.intent.reason };
}

type PageGapSectionOut = {
	contentQualityFindings: string[];
	geoFindings: string[];
	opportunityHighlights: string[];
	gapFixes: Record<string, string>;
	sourcedRecommendations: string[];
	priorityActionPlan: PriorityActionPlan;
	confidenceNotes: string;
};

/** Every gap id must map to a fix; anything the model missed is filled from the engine's own recommended_action. */
function backfillGapFixes(fixes: Record<string, string>, r: PageGapResult): Record<string, string> {
	const out = { ...fixes };
	for (const g of [...r.serpValidatedGaps, ...r.lowConfidenceGaps]) {
		if (!out[g.id]?.trim()) out[g.id] = g.recommended_action || g.suggested_fix || g.title;
	}
	return out;
}

/** §3 Page Gap Analysis — findings, gap fixes, opportunities, action plan. */
export async function analyzePageGapSection(r: PageGapResult): Promise<Partial<PageGapLlm>> {
	await ensureAi();
	const allGapIds = [...r.serpValidatedGaps, ...r.lowConfidenceGaps].map(g => g.id);
	const prompt = `${coreContext(r)}

${benchmarkBlock(r)}

${gapsBlock(r)}

Respond in EXACTLY these delimited sections, in this order, nothing outside them. One bullet per line starting with "- " inside list sections.
===CONTENT_FINDINGS===
Generic/templated-content risks and where original data/experience is absent (bullets).
===GEO_FINDINGS===
Where the target would be skipped by AI Overviews/answer engines and what blocks to add for extractability (bullets).
===OPPORTUNITIES===
Detailed, evidence-backed opportunities the target could own: sub-intents, formats, or audience stages no top-10 page serves well. For EACH bullet give (a) the specific opportunity, (b) the SERP evidence or gap that proves it is open (name ranks/domains), and (c) the principle behind it.
===GAP_FIXES===
For EVERY gap id listed under "ALL GAP IDS", output exactly one line: "<gap_id> :: <one concrete, domain-aware fix that names the competing ranks/domains and quantifies the target>". Do not skip any id. Do not add ids that were not listed.
===SOURCED_RECOMMENDATIONS===
One bullet per SERP-validated gap: a concrete, domain-specific fix that names the competing pages that evidence it.
===CRITICAL===
Intent/page-type issues that override everything (bullets, may be empty).
===QUICK_WINS===
Same-day metadata/schema/FAQ/CTA additions (bullets).
===MEDIUM_FIXES===
1–3 day content restructuring/author/internal-linking (bullets).
===STRATEGIC_REWRITES===
Multi-day work needing original research, tools, or expert input (bullets).
===CONFIDENCE===
One short paragraph on confidence and any data limitations (e.g., pages that failed to render).
===END===`;

	const res = await runAgent<PageGapSectionOut>({
		name: "page-gap-analysis",
		system: SYSTEM,
		prompt,
		maxTokens: 4000,
		timeoutMs: 240000,
		parse: raw => {
			const out: PageGapSectionOut = {
				contentQualityFindings: toBullets(sliceSection(raw, "===CONTENT_FINDINGS===", "===GEO_FINDINGS===")),
				geoFindings: toBullets(sliceSection(raw, "===GEO_FINDINGS===", "===OPPORTUNITIES===")),
				opportunityHighlights: toBullets(sliceSection(raw, "===OPPORTUNITIES===", "===GAP_FIXES===")),
				gapFixes: parseGapFixes(sliceSection(raw, "===GAP_FIXES===", "===SOURCED_RECOMMENDATIONS===")),
				sourcedRecommendations: toBullets(sliceSection(raw, "===SOURCED_RECOMMENDATIONS===", "===CRITICAL===")),
				priorityActionPlan: {
					critical: toBullets(sliceSection(raw, "===CRITICAL===", "===QUICK_WINS===")),
					quickWins: toBullets(sliceSection(raw, "===QUICK_WINS===", "===MEDIUM_FIXES===")),
					mediumFixes: toBullets(sliceSection(raw, "===MEDIUM_FIXES===", "===STRATEGIC_REWRITES===")),
					strategicRewrites: toBullets(sliceSection(raw, "===STRATEGIC_REWRITES===", "===CONFIDENCE===")),
				},
				confidenceNotes: sliceSection(raw, "===CONFIDENCE===", "===END==="),
			};
			const any =
				out.contentQualityFindings.length +
				out.geoFindings.length +
				out.opportunityHighlights.length +
				Object.keys(out.gapFixes).length +
				out.sourcedRecommendations.length;
			return any > 0 ? out : null;
		},
		validate: v => {
			const problems: string[] = [];
			const missing = allGapIds.filter(id => !v.gapFixes[id]?.trim());
			if (missing.length)
				problems.push(
					`GAP_FIXES is missing a fix line for these ids (one "<id> :: <fix>" line each): ${missing.join(", ")}`,
				);
			if (!v.contentQualityFindings.length && !v.geoFindings.length)
				problems.push("CONTENT_FINDINGS and GEO_FINDINGS were both empty — provide concrete bullets.");
			return problems;
		},
	});

	if (res.ok) return { ...res.value, gapFixes: backfillGapFixes(res.value.gapFixes, r) };
	// Model unusable even after retry: the engine's own gap data still gives the
	// user a complete (if terse) section — recommendations and fixes are the
	// deterministic recommended_action for every sourced gap.
	return {
		contentQualityFindings: [],
		geoFindings: [],
		opportunityHighlights: [],
		gapFixes: backfillGapFixes({}, r),
		sourcedRecommendations: r.serpValidatedGaps.map(g => `${g.title}: ${g.recommended_action || g.suggested_fix}`),
		priorityActionPlan: { critical: [], quickWins: [], mediumFixes: [], strategicRewrites: [] },
		confidenceNotes: "AI narrative unavailable for this section — showing the deterministic engine's sourced fixes.",
	};
}

/** §4 Prompts for GEO — refined prompt finder. */
export async function analyzePromptsSection(r: PageGapResult): Promise<Partial<PageGapLlm>> {
	const model = await ensureAi();
	const prompt = `${coreContext(r)}

${promptBaselineBlock(r)}

Respond with EXACTLY this delimited section, nothing outside it:
===PROMPT_FINDER===
Output ONLY a single valid JSON object (no prose, no code fences) refining the GEO Prompt Finder baseline above. Be highly accurate on industry, niche, topic, audience and intent — use the page signals, keyword, and SERP, not guesses. Schema:
{
  "industry": "<specific industry/vertical>",
  "niche": "<the precise niche>",
  "topic": "<the page's core topic>",
  "audience": "<who is searching, specifically>",
  "prompts": [
    {
      "prompt": "<the exact natural-language query a user types into ChatGPT/Perplexity/Gemini/AI Overviews>",
      "intent": "informational|comparison|commercial|transactional|local",
      "platforms": ["ChatGPT","Perplexity","Google AI Overviews","Gemini"],
      "rationale": "<why THIS page should be the cited source for this prompt>",
      "readiness": "ready|partial|missing",
      "alignmentActions": ["<specific GEO change on this page needed to win this prompt>"]
    }
  ],
  "geoOptimizationItems": [
    { "item": "<page-level GEO change>", "why": "<why it matters for AI citation>", "priority": "critical|high|medium|low", "prompts": ["<prompt text this unlocks>"] }
  ]
}
Provide 8–14 realistic, conversational prompts spanning the intent stages this page can plausibly win or expand into. Ground every alignmentAction in the actual gaps/signals provided.
===END===`;

	const res = await runAgent<PromptFinderResult>({
		name: "prompt-finder",
		system: SYSTEM,
		prompt,
		maxTokens: 3000,
		timeoutMs: 240000,
		parse: raw => {
			// parsePromptFinder returns the baseline on any parse failure; detect
			// that so the runner retries instead of silently accepting the baseline.
			const block = sliceSection(raw, "===PROMPT_FINDER===", "===END===");
			if (!block.match(/\{[\s\S]*\}/)) return null;
			const parsed = parsePromptFinder(raw, r.promptFinder, model);
			return parsed.source === "ai" ? parsed : null;
		},
		validate: v =>
			v.prompts.length >= 5
				? []
				: [`"prompts" must contain 8–14 entries (yours had ${v.prompts.length}). Output the full JSON object.`],
	});
	// Deterministic baseline is the safety net — the report is never promptless.
	return { promptFinder: res.ok ? res.value : r.promptFinder };
}

/** §6 artifact (a) — recommended heading blueprint for the target page. */
export async function analyzeStructureSection(r: PageGapResult): Promise<Partial<PageGapLlm>> {
	await ensureAi();
	const prompt = `${coreContext(r)}

${headingsBlock(r)}

${gapsBlock(r)}

Design the recommended HEADING STRUCTURE the target page should have to win this exact SERP intent.
Rules:
- ONLY headings (H1/H2/H3) and where NEW sections must be added — NOT internal copy or paragraph text.
- Drive the additions from the gap analysis and benchmark above (what ranking pages cover that this page lacks).
- Keep the page's good existing headings (status "keep"), flag weak ones to rewrite ("improve"), and add missing ones ("add").
- Order them top-to-bottom as they should appear on the page. Exactly one H1.

Respond in EXACTLY this delimited section, nothing outside it. Between the markers, output ONE heading per line and NOTHING else, in this exact pipe-delimited format (three fields separated by " | ", with the note after " :: "):
LEVEL | STATUS | heading text :: one-line explanation of what belongs here / why
where LEVEL is one of H1, H2, H3 and STATUS is one of keep, add, improve.

Four illustrative lines (DO NOT copy these — produce the real plan for THIS page):
H1 | improve | Best Running Shoes for Flat Feet (2026) :: Front-load the year and audience the top results signal.
H2 | keep | How We Tested :: Existing methodology section — keep, it signals first-hand experience.
H2 | add | Comparison Table: Top 8 Picks :: Ranks #2 and #5 lead with a scannable table; add one.
H3 | add | Best Budget Option :: Sub-pick the leaders break out that this page lacks.

===HEADING_BLUEPRINT===
===END===`;

	const res = await runAgent<HeadingBlueprintItem[]>({
		name: "heading-blueprint",
		system: SYSTEM,
		prompt,
		maxTokens: 2000,
		timeoutMs: 120000,
		parse: raw => {
			const items = parseHeadingBlueprint(sliceSection(raw, "===HEADING_BLUEPRINT===", "===END==="));
			return items.length ? items : null;
		},
		validate: items => {
			const problems: string[] = [];
			if (items.length < 4)
				problems.push("The blueprint must cover the whole page — output every heading, top to bottom.");
			const h1s = items.filter(i => i.level === 1).length;
			if (h1s !== 1) problems.push(`Exactly one H1 is required (yours had ${h1s}).`);
			return problems;
		},
	});
	if (res.ok) return { headingBlueprint: res.value };
	// Fallback: the page's existing outline (all "keep") so the artifact renders.
	const h = r.target.headings;
	const fallback: HeadingBlueprintItem[] = [
		...h.h1.slice(0, 1).map(text => ({ level: 1 as const, text, note: "Existing H1.", status: "keep" as const })),
		...h.h2.map(text => ({ level: 2 as const, text, note: "Existing section.", status: "keep" as const })),
	];
	return { headingBlueprint: fallback };
}

/**
 * Run every section in sequence and merge into one PageGapLlm.
 * Used by the server-action fallback; the streaming route calls the section
 * functions individually so it can report progress between them.
 */
export async function analyzePageGapWithAi(r: PageGapResult): Promise<PageGapLlm> {
	const model = await ensureAi();
	const llm = emptyLlm(model);
	const sections = [
		analyzeCompetitorSection,
		analyzeIntentSection,
		analyzePageGapSection,
		analyzePromptsSection,
		analyzeStructureSection,
	];
	for (const fn of sections) {
		Object.assign(llm, await fn(r));
	}
	llm.model = model;
	llm.generatedAt = new Date().toISOString();
	return llm;
}
