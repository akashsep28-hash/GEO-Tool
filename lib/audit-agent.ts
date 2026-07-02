/**
 * The AI auditor pipeline (v3 — micro-agents + algorithmic patching).
 *
 * The old design made ONE giant LLM call that had to re-derive rule verdicts,
 * invent fixes AND re-emit the entire corrected HTML document — the exact
 * failure mode of small local models (truncation, dropped brand content,
 * hallucinated copy). It is replaced by a pipeline that uses deterministic
 * logic wherever logic can answer, and small single-purpose AI agents only
 * where judgment or short grounded copy is genuinely needed:
 *
 *   deterministic  – working / not-working / gap verdicts derived from the
 *                    already-computed rule engine signals (no AI re-derivation)
 *   deterministic  – a fix registry mapping every known rule issue to a
 *                    concrete, SOP-aligned fix
 *   agent CONTENT-ASSESSOR – judges only what rules can't: answer-first
 *                    quality, factual density, self-containedness, fluff
 *   agent META-WRITER      – ≤65-char title + ≤160-char description (gated:
 *                    only runs when the current ones fail deterministic checks)
 *   agent INTRO-WRITER     – one 50–80 word answer-first opening paragraph
 *                    (gated: only when the page doesn't open answer-first)
 *   agent FAQ-DRAFTER      – 4–6 Q&A drafted from the page's own text (gated:
 *                    only when the page has no visible FAQ), grounding-verified
 *   deterministic  – corrected HTML assembled by patching the ORIGINAL html
 *                    (lib/html-patch.ts): head fixes, alt placeholders, intro,
 *                    FAQ section, JSON-LD. The model never writes HTML.
 *
 * Every agent runs through lib/agent-runner.ts (parse → validate → one
 * corrective retry → best-effort), and every piece of AI copy is verified
 * against the page's own text before it is used — ungrounded output is
 * discarded, never published.
 */
import "server-only";
import { emitAgentEvent, runAgent } from "@/lib/agent-runner";
import { aiAvailability } from "@/lib/ai";
import type { AuditPageRecord } from "@/lib/audit-engine";
import {
	addAltPlaceholders,
	appendFaqSection,
	ensureCanonical,
	ensureLang,
	ensureOgTags,
	ensureScaffold,
	injectAnswerFirstIntro,
	injectJsonLd,
	isGroundedProse,
	looksAnswerFirst,
	setMetaDescription,
	setTitle,
	significantTokens,
} from "@/lib/html-patch";
import { extractVisibleFaqs } from "@/lib/schema-generator";

export type SuggestedFix = { issue: string; fix: string };

export type PageAiAnalysis = {
	working: string[];
	notWorking: string[];
	gaps: string[];
	suggestedFixes: SuggestedFix[];
	correctedHtml: string;
	model: string;
	generatedAt: string;
	/** Which deterministic patches were applied to produce correctedHtml. */
	appliedPatches?: string[];
	/** How many AI calls the pipeline actually made (transparency/cost). */
	aiCalls?: number;
};

// ---------------------------------------------------------------------------
// Deterministic layer 1 — fix registry. Every rule verdict the engine can emit
// maps to a concrete fix; no model needed to know what "no canonical" means.
// ---------------------------------------------------------------------------

type FixTemplate = { match: RegExp; fix: string; autoApplied?: boolean };

const FIX_TEMPLATES: FixTemplate[] = [
	{
		match: /missing an h1/i,
		fix: "Add exactly one H1 that states the page's primary answer/offer in plain language.",
	},
	{
		match: /multiple h1/i,
		fix: "Keep one H1 (the primary topic); demote the others to H2 so engines see one clear subject.",
	},
	{
		match: /no question-style headings/i,
		fix: "Rewrite key H2/H3s as the actual questions users ask (who/what/how/why…) so each section maps to a prompt.",
	},
	{
		match: /no canonical/i,
		fix: 'Add a <link rel="canonical"> pointing at this page\'s preferred URL.',
		autoApplied: true,
	},
	{
		match: /low statistical density/i,
		fix: "Add 3–5 concrete statistics or data points with sources — replace vague claims with numbers ([ADD STAT] where you need real data).",
	},
	{
		match: /no outbound citations/i,
		fix: "Cite 2–3 authoritative external sources inline where the page makes factual claims — engines reward verifiable pages.",
	},
	{
		match: /no comparison\/data table/i,
		fix: "Add one structured comparison/data table for the page's key decision (options, features, prices) — tables are lifted verbatim by answer engines.",
	},
	{
		match: /thin content/i,
		fix: "Expand the page to 600+ words by answering the real questions searchers ask about this topic (see the FAQ/gaps below).",
	},
	{
		match: /no author \/ e-e-a-t signal/i,
		fix: "Add a visible author byline with credentials (and an author bio link) — named authorship is weighed for E-E-A-T.",
	},
	{
		match: /no visible date \/ freshness/i,
		fix: 'Show a visible "Published/Updated" date near the top and keep it current — freshness signals drive citation choice.',
	},
	{
		match: /no structured data/i,
		fix: "Add JSON-LD structured data (Organization + WebPage, plus FAQPage where the page answers questions).",
		autoApplied: true,
	},
	{
		match: /missing meta description/i,
		fix: "Add a ≤160-character answer-first meta description.",
		autoApplied: true,
	},
	{
		match: /no open graph/i,
		fix: "Add og:title / og:description / og:url / og:type tags for share and AI-preview surfaces.",
		autoApplied: true,
	},
	{
		match: /client-side js/i,
		fix: "Server-render (SSR/SSG) the primary content — AI crawlers largely do not execute JavaScript, so client-rendered copy is invisible to them.",
	},
	{ match: /image\(s\) missing alt/i, fix: "Add descriptive alt text to every content image.", autoApplied: true },
	{
		match: /long paragraph/i,
		fix: "Split paragraphs over ~120 words — engines retrieve 500–800 token chunks and skip walls of text.",
	},
];

function templateFixes(page: AuditPageRecord): SuggestedFix[] {
	const issues = [...page.notWorking, ...page.ruleIssues];
	const out: SuggestedFix[] = [];
	const seen = new Set<string>();
	for (const issue of issues) {
		const t = FIX_TEMPLATES.find(f => f.match.test(issue));
		if (!t || seen.has(t.match.source)) continue;
		seen.add(t.match.source);
		out.push({ issue, fix: t.autoApplied ? `${t.fix} (applied in the corrected HTML below)` : t.fix });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Deterministic layer 2 — GEO gap derivation from signals. The rule engine only
// records FAQ/video/etc. when PRESENT; the gaps (absent-but-valuable) are pure
// signal logic, no model required.
// ---------------------------------------------------------------------------

function deterministicGaps(page: AuditPageRecord): string[] {
	const s = page.signals;
	const gaps: string[] = [];
	if (!s.hasFaq)
		gaps.push(
			"No FAQ section — add Q&A mapping to the real prompts users ask; FAQ blocks are the most-lifted GEO format.",
		);
	if (s.questionHeadings === 0 && s.h2.length + s.h3.length > 0)
		gaps.push(
			"No heading matches a user question — every question-style heading is a prompt this page could be cited for.",
		);
	if (s.tableCount === 0 && page.wordCount > 700)
		gaps.push("Long page with no table — a comparison/summary table gives engines an extractable block.");
	if (!s.hasVideo && page.wordCount > 900)
		gaps.push("No video/multimedia — multi-modal pages earn additional surface area in AI results.");
	if (s.internalLinks < 3)
		gaps.push("Weak internal linking — link related pages so crawlers and engines see topical depth.");
	if (s.statMatches === 0)
		gaps.push(
			"No statistics at all — pages with concrete numbers are dramatically more citable than unquantified copy.",
		);
	return gaps;
}

// ---------------------------------------------------------------------------
// Shared parsing helpers (delimited sections — the format small models hold).
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

// ---------------------------------------------------------------------------
// Agent: CONTENT-ASSESSOR — judges only what deterministic rules cannot.
// ---------------------------------------------------------------------------

const SYSTEM_ASSESSOR = `You are a GEO content-quality auditor. You judge ONE page's PROSE — the things automated rules cannot measure: whether the opening actually answers the query, whether claims are specific or vague marketing fluff, whether sections are self-contained enough for an engine to lift, and whether the copy demonstrates first-hand experience.

RULES:
- The deterministic checks listed in the prompt are ALREADY DONE. Do NOT repeat them (do not mention missing meta tags, schema, alt text, canonical, word counts, or anything in the "already checked" list).
- Judge only from the page text you are given. Never invent facts about the business.
- Be concrete: quote or reference the actual copy when you criticise it.
- One bullet per line starting with "- ". Output NOTHING outside the delimited sections.`;

type AssessorOut = { working: string[]; notWorking: string[]; gaps: string[]; fixes: SuggestedFix[] };

function buildAssessorPrompt(page: AuditPageRecord): string {
	const s = page.signals;
	const already = [...page.working, ...page.notWorking].join("; ");
	return `URL: ${page.url}
TITLE: ${page.title || "(none)"}
H1: ${s.h1.join(" | ") || "(none)"}
H2 (first 10): ${s.h2.slice(0, 10).join(" | ") || "(none)"}
WORDS: ${page.wordCount}

ALREADY CHECKED DETERMINISTICALLY (do NOT repeat any of these):
${already || "(none)"}

PAGE TEXT (judge this):
"""
${page.text.slice(0, 4500)}
"""

Respond in EXACTLY these delimited sections, nothing outside them:
===WORKING===
Content-quality strengths (answer-first opening, specificity, first-hand experience, self-contained sections). Bullets.
===NOT_WORKING===
Content-quality problems (vague/marketing copy, buried answers, unsupported claims, sections that assume prior context). Bullets, quoting the copy where useful.
===GAPS===
Missed citation opportunities in the CONTENT itself: questions the topic raises that the page never answers, comparisons it never makes, data it should present. Bullets.
===FIXES===
One line per NOT_WORKING/GAPS item, in the form: <problem> :: <specific rewrite instruction for THIS page>
===END===`;
}

function parseAssessor(raw: string): AssessorOut | null {
	const working = toBullets(sliceSection(raw, "===WORKING===", "===NOT_WORKING==="));
	const notWorking = toBullets(sliceSection(raw, "===NOT_WORKING===", "===GAPS==="));
	const gaps = toBullets(sliceSection(raw, "===GAPS===", "===FIXES==="));
	const fixes = toBullets(sliceSection(raw, "===FIXES===", "===END==="))
		.map(line => {
			const idx = line.indexOf("::");
			if (idx === -1) return null;
			return { issue: line.slice(0, idx).trim(), fix: line.slice(idx + 2).trim() };
		})
		.filter((f): f is SuggestedFix => f !== null && !!f.issue && !!f.fix);
	if (!working.length && !notWorking.length && !gaps.length) return null;
	return { working, notWorking, gaps, fixes };
}

// ---------------------------------------------------------------------------
// Agent: META-WRITER — title + meta description (gated).
// ---------------------------------------------------------------------------

const SYSTEM_META = `You write page titles and meta descriptions for search and AI answer engines. You are given one page's heading and text. Summarise WHAT IS ON THE PAGE — no invented claims, features, prices, or superlatives that the text does not support. Output NOTHING outside the delimited sections.`;

type MetaOut = { title: string; description: string };

function parseMeta(raw: string): MetaOut | null {
	const title = sliceSection(raw, "===TITLE===", "===META===").split(/\r?\n/)[0]?.trim() ?? "";
	const description = sliceSection(raw, "===META===", "===END===").split(/\r?\n/)[0]?.trim() ?? "";
	if (!title && !description) return null;
	return { title, description };
}

// ---------------------------------------------------------------------------
// Agent: INTRO-WRITER — one answer-first opening paragraph (gated).
// ---------------------------------------------------------------------------

const SYSTEM_INTRO = `You write ONE answer-first opening paragraph (50–80 words) for a web page: the direct answer to what the visitor came for, stated immediately, using ONLY facts present in the page text you are given. No greeting, no "welcome", no marketing adjectives, no figures that are not in the source text. Output NOTHING outside the delimited section.`;

// ---------------------------------------------------------------------------
// Agent: FAQ-DRAFTER — grounded Q&A from the page's own text (gated).
// ---------------------------------------------------------------------------

const SYSTEM_FAQ = `You draft FAQ entries for a web page using ONLY the page text you are given. Pick the 4–6 questions this page actually answers (or that its topic obviously raises AND its text can answer), and write answer-first responses of 2–3 sentences each, built strictly from the source text — no new figures, names, or claims. Output a single valid JSON object only: {"faqs":[{"question":"...?","answer":"..."}]}`;

function parseFaqs(raw: string): { question: string; answer: string }[] | null {
	const cleaned = raw.replace(/```(?:json)?/gi, "");
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		const json = JSON.parse(cleaned.slice(start, end + 1)) as { faqs?: unknown };
		if (!Array.isArray(json.faqs)) return null;
		const out = json.faqs
			.map(f => {
				if (!f || typeof f !== "object") return null;
				const o = f as Record<string, unknown>;
				const question = typeof o.question === "string" ? o.question.trim() : "";
				const answer = typeof o.answer === "string" ? o.answer.trim() : "";
				return question && answer ? { question, answer } : null;
			})
			.filter((x): x is { question: string; answer: string } => x !== null);
		return out.length ? out : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Deterministic layer 3 — minimal, standards-safe JSON-LD (only types the page
// lacks; only values the page itself provides). The full registry-driven
// generator remains the Schema Generator module's job — this is the auditor's
// safe baseline.
// ---------------------------------------------------------------------------

function brandFromDomain(url: string): string {
	try {
		const host = new URL(url).hostname.replace(/^www\./, "");
		const name = host.split(".")[0];
		return name.charAt(0).toUpperCase() + name.slice(1);
	} catch {
		return "";
	}
}

function buildMinimalJsonLd(
	page: AuditPageRecord,
	meta: { title: string; description: string },
	faqs: { question: string; answer: string }[],
): unknown[] {
	const existing = new Set(page.signals.schemaTypes.map(t => t.toLowerCase()));
	const out: unknown[] = [];
	let origin = page.url;
	try {
		origin = new URL(page.url).origin;
	} catch {
		/* keep raw */
	}
	const brand = brandFromDomain(page.url);

	if (!existing.has("organization") && brand) {
		out.push({
			"@context": "https://schema.org",
			"@type": "Organization",
			"@id": `${origin}/#organization`,
			name: brand,
			url: origin,
		});
	}
	if (![...existing].some(t => /page$|article/i.test(t))) {
		out.push({
			"@context": "https://schema.org",
			"@type": "WebPage",
			"@id": `${page.url}#webpage`,
			url: page.url,
			name: meta.title || page.title || undefined,
			description: meta.description || page.metaDescription || undefined,
			...(brand ? { publisher: { "@id": `${origin}/#organization` } } : {}),
		});
	}
	if (faqs.length >= 2 && !existing.has("faqpage")) {
		out.push({
			"@context": "https://schema.org",
			"@type": "FAQPage",
			"@id": `${page.url}#faqpage`,
			mainEntity: faqs.map(f => ({
				"@type": "Question",
				name: f.question,
				acceptedAnswer: { "@type": "Answer", text: f.answer },
			})),
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// The pipeline.
// ---------------------------------------------------------------------------

export type AnalyzePageOptions = {
	/**
	 * Called with the accumulated analysis each time a stage's output is ready
	 * (verdicts/fixes after the assessor, the corrected HTML at the end), so the
	 * caller can persist and surface partial results in real time.
	 */
	onPartial?: (ai: PageAiAnalysis) => void | Promise<void>;
};

/** Run the auditor pipeline on one page. Throws only when no model is connected. */
export async function analyzePageWithAi(page: AuditPageRecord, opts: AnalyzePageOptions = {}): Promise<PageAiAnalysis> {
	const avail = await aiAvailability();
	if (!avail.available) {
		throw new Error(
			"No AI model is connected. Connect your local Ollama model (e.g. Gemma) in Settings → AI Models, then try again.",
		);
	}
	const model = avail.label ?? "ai";
	let aiCalls = 0;

	const s = page.signals;
	const pageText = page.text || "";

	// ---- Deterministic gating: decide which agents are needed at all. ----
	const titleBad = !page.title || page.title.length > 65 || page.title.length < 15;
	const metaBad = !page.metaDescription || page.metaDescription.length < 50 || page.metaDescription.length > 170;
	const needsMetaAgent = (titleBad || metaBad) && pageText.length > 100;
	const needsIntroAgent = pageText.length > 200 && !looksAnswerFirst(pageText);
	const visibleFaqs = extractVisibleFaqs(page.html);
	const needsFaqAgent = visibleFaqs.length < 2 && !s.hasFaq && page.wordCount >= 350;

	const skipped = [
		!needsMetaAgent && "title/meta already fine",
		!needsIntroAgent && "opening already answer-first",
		!needsFaqAgent && (visibleFaqs.length >= 2 || s.hasFaq ? "page has its own FAQ" : "page too thin for FAQ"),
	].filter(Boolean);
	emitAgentEvent({
		agent: "pipeline",
		phase: "note",
		attempt: 0,
		detail: `Planned ${1 + Number(needsMetaAgent) + Number(needsIntroAgent) + Number(needsFaqAgent)} AI step(s)${skipped.length ? ` — skipping: ${skipped.join(", ")}` : ""}`,
	});

	// ---- Agent 1: content assessor (always — this is the judgment AI is FOR). ----
	const assessor = await runAgent<AssessorOut>({
		name: "content-assessor",
		system: SYSTEM_ASSESSOR,
		prompt: buildAssessorPrompt(page),
		maxTokens: 1400,
		timeoutMs: 120000,
		parse: parseAssessor,
		validate: v =>
			v.working.length + v.notWorking.length + v.gaps.length >= 2
				? []
				: ["Provide at least two concrete bullets across WORKING / NOT_WORKING / GAPS."],
	});
	aiCalls += assessor.attempts;

	// ---- Deterministic assembly: verdicts + fixes (ready as soon as the
	// assessor lands — disbursed immediately so the report fills in live). ----
	const detGaps = deterministicGaps(page);
	const detFixes = templateFixes(page);

	const working = assessor.ok && assessor.value.working.length ? assessor.value.working : page.working;
	const notWorking = assessor.ok && assessor.value.notWorking.length ? assessor.value.notWorking : page.notWorking;
	const gaps = [...detGaps, ...(assessor.ok ? assessor.value.gaps : [])];

	const suggestedFixes: SuggestedFix[] = [...detFixes];
	if (assessor.ok) {
		const have = new Set(suggestedFixes.map(f => f.issue.toLowerCase()));
		for (const f of assessor.value.fixes) {
			if (!have.has(f.issue.toLowerCase())) suggestedFixes.push(f);
		}
	}

	await opts.onPartial?.({
		working,
		notWorking,
		gaps,
		suggestedFixes,
		correctedHtml: "",
		model,
		generatedAt: new Date().toISOString(),
		appliedPatches: [],
		aiCalls,
	});

	// ---- Agents 2–4: gated copy writers, run only when the page needs them. ----
	const tokensOfPage = new Set(significantTokens(`${page.title} ${s.h1.join(" ")} ${pageText.slice(0, 2000)}`));

	let metaOut: MetaOut = { title: "", description: "" };
	if (needsMetaAgent) {
		const res = await runAgent<MetaOut>({
			name: "meta-writer",
			system: SYSTEM_META,
			prompt: `URL: ${page.url}
H1: ${s.h1.join(" | ") || "(none)"}
CURRENT TITLE: ${page.title || "(none)"}
CURRENT META DESCRIPTION: ${page.metaDescription || "(none)"}

PAGE TEXT:
"""
${pageText.slice(0, 2500)}
"""

Respond in EXACTLY these delimited sections:
===TITLE===
One title, 30–60 characters, front-loading the page's primary topic.
===META===
One meta description, 120–160 characters, answer-first, no fluff.
===END===`,
			maxTokens: 300,
			timeoutMs: 60000,
			parse: parseMeta,
			validate: v => {
				const problems: string[] = [];
				if (v.title && (v.title.length < 15 || v.title.length > 65))
					problems.push(`TITLE must be 30–60 characters (yours was ${v.title.length}).`);
				if (v.description && (v.description.length < 50 || v.description.length > 170))
					problems.push(`META must be 120–160 characters (yours was ${v.description.length}).`);
				if (v.title && !significantTokens(v.title).some(t => tokensOfPage.has(t)))
					problems.push("TITLE must reflect the page's actual topic words.");
				return problems;
			},
		});
		aiCalls += res.attempts;
		if (res.ok) metaOut = res.value;
	}

	let intro = "";
	if (needsIntroAgent) {
		const res = await runAgent<string>({
			name: "intro-writer",
			system: SYSTEM_INTRO,
			prompt: `URL: ${page.url}
H1: ${s.h1.join(" | ") || page.title || "(none)"}

PAGE TEXT (the ONLY source you may use):
"""
${pageText.slice(0, 4000)}
"""

Respond in EXACTLY this delimited section:
===INTRO===
The 50–80 word answer-first paragraph.
===END===`,
			maxTokens: 250,
			timeoutMs: 60000,
			parse: raw => {
				const text = sliceSection(raw, "===INTRO===", "===END===").replace(/\s+/g, " ").trim();
				return text || null;
			},
			validate: v => {
				const words = v.split(/\s+/).length;
				const problems: string[] = [];
				if (words < 35 || words > 95) problems.push(`INTRO must be 50–80 words (yours was ${words}).`);
				if (!isGroundedProse(v, pageText, 0.35))
					problems.push(
						"INTRO contained wording or figures not supported by the PAGE TEXT — use only facts from the source.",
					);
				return problems;
			},
		});
		aiCalls += res.attempts;
		if (res.ok && isGroundedProse(res.value, pageText, 0.35)) intro = res.value;
	}

	let draftedFaqs: { question: string; answer: string }[] = [];
	if (needsFaqAgent) {
		const res = await runAgent<{ question: string; answer: string }[]>({
			name: "faq-drafter",
			system: SYSTEM_FAQ,
			prompt: `URL: ${page.url}
TOPIC: ${s.h1.join(" | ") || page.title || "(unknown)"}

PAGE TEXT (the ONLY source you may use):
"""
${pageText.slice(0, 6000)}
"""`,
			maxTokens: 1200,
			timeoutMs: 120000,
			parse: parseFaqs,
			validate: faqs => {
				const grounded = faqs.filter(f => isGroundedProse(f.answer, pageText, 0.4));
				return grounded.length >= 2
					? []
					: [
							"Fewer than two answers were supported by the PAGE TEXT. Every answer must be built only from the source text.",
						];
			},
		});
		aiCalls += res.attempts;
		if (res.ok) draftedFaqs = res.value.filter(f => isGroundedProse(f.answer, pageText, 0.4)).slice(0, 6);
	}

	// ---- Deterministic assembly: corrected HTML by patching the original. ----
	emitAgentEvent({
		agent: "pipeline",
		phase: "note",
		attempt: 0,
		detail: "Patching your original HTML (head fixes, alt text, intro, FAQ, JSON-LD)…",
	});
	const applied: string[] = [];
	let html = ensureScaffold(page.html);

	if (titleBad && metaOut.title) {
		const r = setTitle(html, metaOut.title);
		if (r.applied) {
			html = r.html;
			applied.push(`Title rewritten (${metaOut.title.length} chars)`);
		}
	}
	if (metaBad && metaOut.description) {
		const r = setMetaDescription(html, metaOut.description);
		if (r.applied) {
			html = r.html;
			applied.push(`Meta description ${page.metaDescription ? "rewritten" : "added"}`);
		}
	}
	if (!s.canonical) {
		const r = ensureCanonical(html, page.url);
		if (r.applied) {
			html = r.html;
			applied.push("Canonical link added");
		}
	}
	if (!s.hasLang) {
		const r = ensureLang(html);
		if (r.applied) {
			html = r.html;
			applied.push("html lang attribute added");
		}
	}
	if (!s.hasOpenGraph) {
		const r = ensureOgTags(html, {
			title: metaOut.title || page.title,
			description: metaOut.description || page.metaDescription,
			url: page.url,
		});
		if (r.applied) {
			html = r.html;
			applied.push("Open Graph tags added");
		}
	}
	if (s.imagesWithoutAlt > 0) {
		const r = addAltPlaceholders(html);
		if (r.applied) {
			html = r.html;
			applied.push(`Alt placeholders on ${r.count} image(s) — replace with real descriptions`);
		}
	}
	if (intro) {
		const r = injectAnswerFirstIntro(html, intro);
		if (r.applied) {
			html = r.html;
			applied.push("Answer-first intro paragraph inserted after the H1");
		}
	}
	if (draftedFaqs.length >= 2) {
		const r = appendFaqSection(html, draftedFaqs);
		if (r.applied) {
			html = r.html;
			applied.push(`FAQ section with ${draftedFaqs.length} grounded Q&A appended`);
		}
	}
	const schemaFaqs = visibleFaqs.length >= 2 ? visibleFaqs : draftedFaqs;
	const jsonld = buildMinimalJsonLd(
		page,
		{ title: metaOut.title || page.title, description: metaOut.description || page.metaDescription },
		schemaFaqs,
	);
	if (jsonld.length) {
		const r = injectJsonLd(html, jsonld);
		if (r.applied) {
			html = r.html;
			applied.push(`JSON-LD injected (${jsonld.map(o => (o as { "@type": string })["@type"]).join(", ")})`);
		}
	}

	return {
		working,
		notWorking,
		gaps,
		suggestedFixes,
		correctedHtml: applied.length ? html : "",
		model,
		generatedAt: new Date().toISOString(),
		appliedPatches: applied,
		aiCalls,
	};
}
