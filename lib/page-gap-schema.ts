/**
 * Page Gap Analyzer — Schema (Schema.org JSON-LD) generator sub-module.
 *
 * Built on google/schema-dts (the canonical, standards-correct Schema.org
 * TypeScript types) so every object we assemble is valid Schema.org BY
 * CONSTRUCTION — the compiler rejects wrong property names/shapes.
 *
 * Why this design eliminates syntax errors entirely: the LLM NEVER writes
 * JSON-LD structure. It only returns a constrained "content pack" of plain
 * strings (descriptions + FAQ answers). WE assemble the JSON-LD from those
 * strings using schema-dts-typed builders, then JSON.stringify (always valid
 * JSON) with HTML-safe escaping. Even if the model returns garbage, we fall
 * back to deterministic content and still emit valid schema.
 *
 * Generation strategy:
 *  1. PRESERVE the page's existing JSON-LD (re-parsed from captured HTML).
 *  2. EXTEND with the types the page is missing — identified from the SOURCED
 *     GAP FINDINGS and the BENCHMARK (what the ranking pages ship).
 *  3. FILL every section with GEO-optimized content from the LLM.
 *  4. FOLD qualified GEO Prompt Finder prompts into the FAQPage schema.
 *  5. GUARDRAILS: typed builders + deep sanitise + JSON round-trip gate.
 */
import "server-only";
import type {
	Article,
	BreadcrumbList,
	CollectionPage,
	FAQPage,
	ListItem,
	NewsArticle,
	Organization,
	Question,
	Service,
	Thing,
	WebApplication,
	WebPage,
	WebSite,
	WithContext,
} from "schema-dts";
import { emitAgentEvent, runAgent } from "@/lib/agent-runner";
import { aiAvailability } from "@/lib/ai";
import type { BenchmarkRow, Gap, PageType } from "@/lib/page-gap-engine";
import type { PageGapResult } from "@/lib/page-gap-run";
import {
	canonicalType,
	foundationTypes,
	getSpec,
	industrySchemaTypes,
	type PropertySpec,
	primaryTypeFor,
	SCHEMA_REGISTRY,
} from "@/lib/page-gap-schema-registry";
import type { GeoPrompt, PromptFinderResult } from "@/lib/prompt-finder";

type JsonLd = Record<string, unknown>;

/**
 * A schema item we could NOT emit because the supporting content is not on the
 * page. Surfaced to the user as a content task instead of being fabricated.
 */
export type SchemaRecommendation = {
	/** The schema type the page is missing content for. */
	type: string;
	/** The specific property/section that needs content, if applicable. */
	field?: string;
	/** Why it's worth adding (competitor/SERP evidence or standard). */
	reason: string;
	/** Concrete content action for the page owner. */
	action: string;
	/** For FAQ recs: the raw question, so the UI can request a grounded draft. */
	question?: string;
};

export type SchemaResult = {
	jsonld: JsonLd[];
	types: string[];
	existingTypes: string[];
	addedTypes: string[];
	recommendedTypes: string[];
	rationale: string;
	competitorSchemaTypes: { type: string; count: number; total: number }[];
	gapSignals: string[];
	/** GEO prompts that were folded into the FAQPage. */
	faqFromPrompts: string[];
	/** Content the page must add before the gated schema can be emitted. */
	recommendations: SchemaRecommendation[];
	source: "ai" | "deterministic";
	model: string | null;
	warnings: string[];
	generatedAt: string;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function originOf(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return "";
	}
}

function titleCase(s: string): string {
	return s
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, c => c.toUpperCase());
}

function brandFromDomain(domain: string): string {
	const host = (domain || "").replace(/^www\./, "");
	const core = host.split(".")[0] || host;
	return titleCase(core);
}

function normaliseType(raw: string): string {
	const last = String(raw || "")
		.split(/[/#]/)
		.pop()!
		.trim();
	return last.replace(/[^A-Za-z]/g, "");
}

function typeTokens(o: JsonLd): string[] {
	const t = o["@type"];
	if (typeof t === "string") return [t];
	if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
	return [];
}

function ensureQuestion(s: string): string {
	// Strip GEO prompt intent labels like "[informational]" or "[transactional]"
	// that appear in raw keyword prompts but must never appear in public FAQ text.
	const trimmed = s
		.trim()
		.replace(/\s*\[[^\]]*\]\s*/g, " ")
		.replace(/\s+\?/, "?") // collapse any space left before a trailing ?
		.replace(/\s+/g, " ")
		.trim();
	if (/[?]\s*$/.test(trimmed)) return trimmed[0].toUpperCase() + trimmed.slice(1);
	const cap = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
	return `${cap}?`;
}

/**
 * Canonical key for near-duplicate FAQ detection. Folding GEO keyword prompts
 * into the page's own FAQ produces variants of one question — singular/plural
 * ("loan"/"loans"), missing articles ("what is online personal loans"), and
 * SEO geo-qualifiers ("...in India"). Exact-string dedup misses all of these.
 * We reduce a question to its SORTED SET of significant tokens (articles,
 * copulas, prepositions and SEO modifiers dropped; plurals singularised) so the
 * variants collapse, while keeping question words (what/how/who/…) so genuinely
 * different intents stay distinct.
 */
const FAQ_STOP = new Set(
	"a an the is are am was were be been being do does did to for of on in at by with and or but as your you i we our their them they it its this that these those from about into out up down".split(
		" ",
	),
);
/** SEO keyword modifiers that vary between a page's FAQ and its target keywords but don't change the question. */
const FAQ_QUALIFIER = new Set("online india indian best top near me app apps".split(" "));

function faqDedupKey(q: string): string {
	const toks = q
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.filter(w => !FAQ_STOP.has(w) && !FAQ_QUALIFIER.has(w))
		.map(w => w.replace(/ies$/, "y").replace(/([a-z]{3,})s$/, "$1")); // crude singularise
	return [...new Set(toks)].sort().join(" ");
}

/**
 * Quality score to pick the BEST surviving variant on a collision: a question
 * with an article reads as natural English ("what is **an** online personal
 * loan?") versus a raw keyword ("what is online personal loans?"); answer length
 * is a mild tiebreak so we keep the more informative entry.
 */
function faqScore(f: { question: string; answer: string }): number {
	const words = f.question.toLowerCase().split(/\s+/);
	const hasArticle = words.includes("a") || words.includes("an") || words.includes("the") ? 1 : 0;
	return hasArticle * 100000 + Math.min(f.answer.length, 2000);
}

/** Collapse near-duplicate questions, keeping the highest-quality variant of each. */
function dedupeFaqs(faqs: { question: string; answer: string }[]): { question: string; answer: string }[] {
	const best = new Map<string, { question: string; answer: string }>();
	const order: string[] = [];
	for (const f of faqs) {
		const key = faqDedupKey(f.question);
		if (!key) continue;
		const cur = best.get(key);
		if (!cur) {
			best.set(key, f);
			order.push(key);
		} else if (faqScore(f) > faqScore(cur)) {
			best.set(key, f);
		}
	}
	return order.map(k => best.get(k)!);
}

// ---------------------------------------------------------------------------
// Existing JSON-LD extraction (the "preserve" input)
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;|&#0*39;/g, "'")
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCp(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => safeCp(parseInt(d, 10)))
		.replace(/&amp;/g, "&");
}

function safeCp(n: number): string {
	try {
		return String.fromCodePoint(n);
	} catch {
		return "";
	}
}

export function extractExistingJsonLd(html: string): JsonLd[] {
	const out: JsonLd[] = [];
	if (!html) return out;
	const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(decodeEntities(m[1].trim()));
		} catch {
			continue; // malformed existing schema — drop it, never carry a syntax error
		}
		const push = (node: unknown) => {
			if (!node) return;
			if (Array.isArray(node)) return node.forEach(push);
			if (typeof node !== "object") return;
			const o = node as JsonLd;
			if (Array.isArray(o["@graph"])) return (o["@graph"] as unknown[]).forEach(push);
			if (o["@type"]) out.push(o);
		};
		push(parsed);
	}
	return out;
}

/** Extract existing Q&A pairs from any existing FAQPage blocks. */
function extractExistingFaq(existing: JsonLd[]): { question: string; answer: string }[] {
	const out: { question: string; answer: string }[] = [];
	for (const o of existing) {
		if (!typeTokens(o).some(t => /faqpage/i.test(t))) continue;
		const me = o.mainEntity;
		const arr = Array.isArray(me) ? me : me ? [me] : [];
		for (const q of arr) {
			if (!q || typeof q !== "object") continue;
			const qo = q as JsonLd;
			const question = typeof qo.name === "string" ? qo.name : "";
			const ans = qo.acceptedAnswer as JsonLd | undefined;
			const answer = ans && typeof ans.text === "string" ? ans.text : "";
			if (question) out.push({ question, answer });
		}
	}
	return out;
}

export function tallyCompetitorSchema(benchmark: BenchmarkRow[]): { type: string; count: number; total: number }[] {
	const comp = benchmark.filter(b => b.rank > 0);
	const total = comp.length;
	const counts = new Map<string, number>();
	for (const b of comp) {
		for (const raw of b.schema_types) {
			const t = normaliseType(raw);
			if (!t) continue;
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}
	}
	return [...counts.entries()].map(([type, count]) => ({ type, count, total })).sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Qualified GEO prompts → FAQ candidates (requirement 4)
// ---------------------------------------------------------------------------

/**
 * Pick the GEO Prompt Finder prompts that qualify as FAQ entries: question-like
 * intent the page can plausibly answer (ready/partial, not "missing"). Capped to
 * keep the FAQ focused.
 */
export function selectQualifiedPrompts(pf: PromptFinderResult | null | undefined): GeoPrompt[] {
	if (!pf?.prompts?.length) return [];
	const looksLikeQuestion = (s: string) =>
		/[?]\s*$/.test(s) ||
		/^(what|why|how|when|where|who|which|is|are|can|does|do|should|will|cost|how much|are there)\b/i.test(s.trim());
	return pf.prompts
		.filter(
			p =>
				p.readiness !== "missing" &&
				(p.intent === "informational" || p.intent === "comparison" || looksLikeQuestion(p.prompt)),
		)
		.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Plan — which schema types the page should ultimately have.
// ---------------------------------------------------------------------------

const PRIMARY_REASON: Record<string, string> = {
	Service: "Product/service page → Service (with provider).",
	Article: "Editorial/comparison page → Article.",
	NewsArticle: "News page → NewsArticle.",
	WebApplication: "Interactive tool → WebApplication.",
	CollectionPage: "Category/listing page → CollectionPage.",
	WebPage: "Ambiguous page type → WebPage.",
};

/** Primary entity type for a page, sourced from the schema registry. */
function primaryTypeForPage(pt: PageType): { type: string; reason: string } {
	const type = primaryTypeFor(pt);
	return { type, reason: PRIMARY_REASON[type] ?? `${type} for this page type.` };
}

function isEditorial(pt: PageType): boolean {
	return pt === "blog_guide" || pt === "news" || pt === "comparison";
}

export type SchemaPlan = {
	existingTypes: string[];
	recommended: string[];
	added: string[];
	primary: string;
	reasons: string[];
	gapSignals: string[];
	competitorSchemaTypes: { type: string; count: number; total: number }[];
};

/**
 * Schema type names explicitly NAMED in the sourced gap findings — e.g. the
 * hybrid-intent recommendation "Add Product, Service, LoanOrCredit, or FAQPage
 * JSON-LD as relevant." This is how the SCHEMA SET takes input from the gap
 * findings: any registry type a schema / structured-data / eeat / intent gap
 * recommends becomes a candidate. Returns canonical registry type → the gap
 * title that named it.
 */
const GAP_SCHEMA_NAME_RE = new RegExp(
	`\\b(${[...Object.keys(SCHEMA_REGISTRY), "BlogPosting", "FinancialService", "BankAccount", "Vehicle", "Breadcrumb"]
		.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|")})\\b`,
	"gi",
);

function schemaTypesFromGaps(gaps: Gap[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const g of gaps) {
		const relevant =
			g.category === "schema" ||
			g.category === "intent" ||
			g.dimension === "structured_data" ||
			g.dimension === "eeat";
		if (!relevant) continue;
		const text = `${g.title} ${g.recommended_action}`;
		for (const raw of text.match(GAP_SCHEMA_NAME_RE) ?? []) {
			const c = canonicalType(raw);
			if (c && !out.has(c)) out.set(c, g.title);
		}
	}
	return out;
}

export function buildSchemaPlan(report: PageGapResult, existing: JsonLd[]): SchemaPlan {
	const t = report.target.features;
	const tally = tallyCompetitorSchema(report.benchmark);
	const comp = report.benchmark.filter(b => b.rank > 0);
	const compTotal = comp.length;

	const existingTypes = [...new Set(existing.flatMap(typeTokens).map(normaliseType).filter(Boolean))];
	const have = new Set(existingTypes.map(x => x.toLowerCase()));

	const recommended = new Set<string>(existingTypes);
	const reasons: string[] = [];
	const gapSignals: string[] = [];

	const want = (type: string, reason: string) => {
		if (!recommended.has(type)) recommended.add(type);
		if (!have.has(type.toLowerCase())) reasons.push(reason);
	};

	// Foundation entities (always — proper-standards baseline, from registry).
	const foundationReason: Record<string, string> = {
		Organization: "Organization identifies the publishing entity.",
		WebSite: "WebSite anchors the site for knowledge-graph/sitelinks.",
		WebPage: "WebPage describes this URL as a page entity.",
	};
	for (const f of foundationTypes()) want(f, foundationReason[f] ?? `${f} (foundation entity).`);

	const primary = primaryTypeForPage(report.intent.targetPageType);
	want(primary.type, primary.reason);

	const bcCount = comp.filter(b => b.breadcrumb_schema).length;
	if (breadcrumbItems(report.target.finalUrl || report.targetUrl).length >= 2)
		want(
			"BreadcrumbList",
			bcCount >= 2
				? `BreadcrumbList — ${bcCount}/${compTotal} ranking pages mark up breadcrumbs.`
				: "BreadcrumbList for navigation rich results (URL has a path).",
		);

	const faqSchemaCount = comp.filter(b => b.faq_schema).length;
	const targetFaqCount = t.faqQuestions?.length ?? 0;
	if (t.hasFaq || targetFaqCount > 0)
		want("FAQPage", `Page exposes ${targetFaqCount || "some"} FAQ question(s) → FAQPage.`);
	else if (faqSchemaCount >= 2)
		want("FAQPage", `FAQPage — ${faqSchemaCount}/${compTotal} ranking pages mark up FAQs.`);

	// SERP-sourced: any schema type 3+ ranking pages use that we don't yet plan.
	for (const x of tally)
		if (x.count >= 3 && !recommended.has(x.type))
			want(x.type, `${x.type} — ${x.count}/${x.total} ranking pages ship it (SERP-validated).`);

	// Gap-finding driven additions.
	for (const g of report.gaps) {
		const isSchema = g.dimension === "structured_data" || g.category === "schema";
		const isEeat = g.dimension === "eeat";
		if (!isSchema && !isEeat) continue;
		gapSignals.push(`[${g.severity}] ${g.title}`);
		if (g.id === "schema.faq_content_no_schema") want("FAQPage", `Gap: ${g.title}`);
		if (g.id === "schema.none") {
			want("Organization", `Gap: ${g.title}`);
			want(primary.type, `Gap: ${g.title}`);
		}
		if (g.id === "eeat.no_named_author" && isEditorial(report.intent.targetPageType))
			want("Person", `Gap: ${g.title} → author attribution.`);
	}

	// Industry-specific + gap-named entities. This is where the SCHEMA SET takes
	// input from the detected industry and the sourced gap findings, so the
	// generator (whose source of truth is this set) can emit them.
	const pt = report.intent.targetPageType;
	const appliesHere = (type: string): boolean => {
		const spec = getSpec(type);
		return !!spec && (spec.appliesTo === "all" || spec.appliesTo.includes(pt));
	};
	// The industry's signature entity belongs on commercial page formats.
	const isCommercial = pt === "product_service" || pt === "hybrid" || pt === "category" || pt === "tool";
	if (isCommercial)
		for (const it of industrySchemaTypes(report.promptFinder?.industry))
			if (appliesHere(it)) want(it, `Industry (${report.promptFinder?.industry}) -> ${it} schema.`);
	// Any registry type the sourced gap findings explicitly recommend (e.g.
	// LoanOrCredit from the hybrid-schema gap), gated by page-type fit.
	for (const [type, title] of schemaTypesFromGaps(report.gaps))
		if (appliesHere(type)) want(type, `Sourced gap "${title}" -> ${type} schema.`);

	const recArr = [...recommended];
	return {
		existingTypes,
		recommended: recArr,
		added: recArr.filter(x => !have.has(x.toLowerCase())),
		primary: primary.type,
		reasons,
		gapSignals: [...new Set(gapSignals)],
		competitorSchemaTypes: tally,
	};
}

/**
 * Lightweight, AI-free view of the schema TYPE NAMES the page should carry —
 * the input contract surfaced in the Target Artifacts "Schema set" block. Reuses
 * the same plan the generator uses, so the artifact and the generated schema
 * always agree on which types are in scope.
 */
export function planSchemaTypeNames(report: PageGapResult): {
	existing: string[];
	recommended: string[];
	added: string[];
	primary: string;
} {
	const existing = extractExistingJsonLd(report.target.html);
	const plan = buildSchemaPlan(report, existing);
	return {
		existing: plan.existingTypes,
		recommended: plan.recommended,
		added: plan.added,
		primary: plan.primary,
	};
}

function breadcrumbItems(finalUrl: string): { name: string; item: string }[] {
	let u: URL;
	try {
		u = new URL(finalUrl);
	} catch {
		return [];
	}
	const segs = u.pathname.split("/").filter(Boolean);
	const items = [{ name: "Home", item: u.origin }];
	let path = u.origin;
	for (const seg of segs) {
		path += `/${seg}`;
		items.push({
			name: titleCase(decodeURIComponent(seg.replace(/\.(html?|php|aspx?)$/i, ""))),
			item: path,
		});
	}
	return items.length >= 2 ? items : [];
}

// ---------------------------------------------------------------------------
// Readable page text + grounding — the anti-fabrication substrate.
// ---------------------------------------------------------------------------

/** Strip a captured HTML document down to readable text for extraction. */
export function extractReadableText(html: string, cap = 14000): string {
	if (!html) return "";
	const text = decodeEntities(
		html
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/\s+/g, " ")
		.trim();
	return text.slice(0, cap);
}

const STOP = new Set(
	"the a an and or of to in for on at by with is are be as it its this that from your you we our their".split(" "),
);

function normTokens(s: string): string[] {
	return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 2 && !STOP.has(w));
}

function containsCI(haystack: string, needle: string): boolean {
	return !!needle && haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Is `snippet` actually supported by `pageText`? Measures how many of the
 * snippet's significant tokens appear in the page text. Used to reject answers
 * the model wrote from general knowledge rather than from the page.
 */
function isGrounded(snippet: string, pageText: string, threshold = 0.6): boolean {
	const snipTokens = normTokens(snippet);
	if (snipTokens.length < 3) return false; // too short to verify
	const page = new Set(normTokens(pageText));
	const hits = snipTokens.filter(w => page.has(w)).length;
	return hits / snipTokens.length >= threshold;
}

// ---------------------------------------------------------------------------
// Content pack — EXTRACTED (not authored) facts the LLM locates in page text.
// ---------------------------------------------------------------------------

/**
 * A model-driven decision about one property on one existing schema node.
 * Only DROP and UPDATE decisions are emitted — omit means KEEP.
 */
export type SchemaAuditDecision = {
	/** @id of the node being audited. */
	nodeId: string;
	/** Property name (e.g. "commentCount", "interestRate", "author"). Use
	 *  "potentialAction:CommentAction" to target only the CommentAction entry
	 *  inside a potentialAction array without removing other action types. */
	property: string;
	action: "drop" | "update";
	/** New value when action is "update". */
	updatedValue?: unknown;
	/** One sentence grounded in page evidence: what the page says or doesn't say. */
	reason: string;
};

export type ContentPack = {
	metaDescription: string;
	organizationDescription: string;
	primaryDescription: string;
	/** Real byline name if present on the page, else "". */
	author: string;
	/** ISO date if present on the page, else "". */
	datePublished: string;
	dateModified: string;
	faqs: { question: string; answer: string }[];
	/** Model-driven audit of existing schema properties. */
	schemaAudit: SchemaAuditDecision[];
};

const SYSTEM_EXTRACT = `You are a GEO/SEO data EXTRACTOR. You are given the readable TEXT of ONE web page. Your job is to LOCATE facts already present in that text and return them as clean strings. You are NOT a copywriter — you do not add, infer, or generalize information.

HARD RULES:
- Use ONLY what is present in the PAGE TEXT. If a value is not in the page text, return an empty string "" for it (and for FAQs, OMIT the entry). NEVER invent it.
- NEVER output a price, date, author name, statistic, award, address, or phone number unless it appears verbatim in the PAGE TEXT.
- FAQ answers must be supported by the PAGE TEXT. Answer ONLY questions the page actually answers, condensing the page's own wording (answer-first, 2–4 sentences). If the page does not answer a listed question, OMIT that question entirely — do NOT write a general-knowledge answer.
- Descriptions (meta/org/primary) must be faithful summaries of the PAGE TEXT — concise, answer-first, no marketing fluff, and no claim that isn't on the page.
- Output a single valid JSON object only (no markdown, no code fences, no commentary).`;

const SYSTEM_AUDIT = `You are a structured-data fact-checker. You are given the readable TEXT of ONE web page and a list of properties currently asserted in the page's existing JSON-LD schema. For each property you decide whether the claimed value is actually supported by the page text.

HARD RULES:
- Emit a decision ONLY if the property should be DROPPED (not on page) or UPDATED (wrong value; page shows a different one). Omit = keep as-is.
- A property that asserts a specific number, name, date, or claim must appear in the PAGE TEXT to stay. If it does not appear, emit action "drop".
- For "potentialAction" array items, use property syntax "potentialAction:ActionType" (e.g. "potentialAction:CommentAction") to target only that action type.
- "reason" must cite the page evidence (or lack thereof) in one sentence.
- Never drop structural properties (url, name, headline, isPartOf, publisher, etc.) — those are handled separately.
- Output a single valid JSON object only (no markdown, no code fences, no commentary).`;

/** Shared header block (url/keyword/brand/type) used by both schema agents. */
function pageHeaderBlock(report: PageGapResult): string {
	const t = report.target.features;
	const pf = report.promptFinder;
	const url = report.target.finalUrl || report.targetUrl;
	return `TARGET URL: ${url}
KEYWORD: ${report.keyword}
BRAND: ${brandFromDomain(report.target.domain || t.domain)}
PAGE TITLE: ${report.target.title || t.title || "(none)"}
H1: ${t.h1Text || "(none)"}
EXISTING META DESCRIPTION: ${report.target.metaDescription || "(none)"}
PAGE TYPE: ${report.intent.targetPageType}
INDUSTRY / NICHE / TOPIC / AUDIENCE: ${pf?.industry ?? "?"} / ${pf?.niche ?? "?"} / ${pf?.topic ?? "?"} / ${pf?.audience ?? "?"}${pf?.isYmyl ? " (YMYL — be especially accurate and non-misleading)" : ""}`;
}

function buildExtractionPrompt(
	report: PageGapResult,
	plan: SchemaPlan,
	pageText: string,
	existingFaq: { question: string; answer: string }[],
	qualifiedPrompts: GeoPrompt[],
): string {
	const t = report.target.features;
	const existingFaqBlock = existingFaq.length
		? existingFaq.map((f, i) => `${i + 1}. Q: ${f.question}\n   (current answer: ${f.answer || "none"})`).join("\n")
		: "(none)";
	const pageFaqBlock = (t.faqQuestions ?? []).length
		? (t.faqQuestions ?? []).map((q, i) => `${i + 1}. ${q}`).join("\n")
		: "(none)";
	const promptBlock = qualifiedPrompts.length
		? qualifiedPrompts.map((p, i) => `${i + 1}. ${p.prompt} [${p.intent}]`).join("\n")
		: "(none)";

	return `${pageHeaderBlock(report)}

===== PAGE TEXT (the ONLY source you may use) =====
${pageText || "(page text unavailable)"}
===== END PAGE TEXT =====

EXISTING FAQ ON THE PAGE (improve only using PAGE TEXT; keep if already good):
${existingFaqBlock}

FAQ QUESTIONS VISIBLE ON THE PAGE (answer ONLY if the PAGE TEXT answers them):
${pageFaqBlock}

CANDIDATE GEO QUESTIONS — include a question ONLY if the PAGE TEXT already answers it; otherwise OMIT it (do not fabricate an answer):
${promptBlock}

Produce ONLY this JSON object. Use "" (or omit FAQ entries) for anything not present in the PAGE TEXT:
{
  "metaDescription": "<≤160 char faithful summary of the page, or \\"\\">",
  "organizationDescription": "<1–2 sentence brand description grounded in the page, or \\"\\">",
  "primaryDescription": "<1–2 sentence description of the page's ${plan.primary}, grounded in the page, or \\"\\">",
  "author": "<author/byline name if it appears on the page, else \\"\\">",
  "datePublished": "<YYYY-MM-DD if a publish date appears on the page, else \\"\\">",
  "dateModified": "<YYYY-MM-DD if an updated date appears on the page, else \\"\\">",
  "faqs": [ { "question": "<clear question ending in '?'>", "answer": "<2–4 sentence answer drawn from the PAGE TEXT>" } ]
}`;
}

function buildAuditPrompt(report: PageGapResult, pageText: string, existingNodes: JsonLd[]): string {
	return `${pageHeaderBlock(report)}

===== PAGE TEXT (the ONLY source you may use) =====
${pageText || "(page text unavailable)"}
===== END PAGE TEXT =====

===== EXISTING SCHEMA PROPERTIES TO AUDIT =====
${serializeForAudit(existingNodes)}
===== END EXISTING SCHEMA PROPERTIES =====

Produce ONLY this JSON object (an empty array means every property is supported and kept):
{
  "schemaAudit": [ { "nodeId": "<@id of node>", "property": "<property name>", "action": "drop" or "update", "updatedValue": <only for update>, "reason": "<one sentence citing page evidence>" } ]
}`;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
	const cleaned = raw.replace(/```(?:json)?/gi, "");
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return null;
	try {
		return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return null;
	}
}

const jsonStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Parse the extraction agent's output (descriptions/author/dates/FAQs — no audit). */
function parseExtraction(raw: string): ContentPack | null {
	const json = extractJsonObject(raw);
	if (!json) return null;
	const faqsRaw = Array.isArray(json.faqs) ? json.faqs : [];
	const faqs = faqsRaw
		.map(f => {
			if (!f || typeof f !== "object") return null;
			const o = f as Record<string, unknown>;
			const question = jsonStr(o.question);
			const answer = jsonStr(o.answer);
			if (!question || !answer) return null;
			return { question: ensureQuestion(question), answer };
		})
		.filter((x): x is { question: string; answer: string } => x !== null);
	return {
		metaDescription: jsonStr(json.metaDescription),
		organizationDescription: jsonStr(json.organizationDescription),
		primaryDescription: jsonStr(json.primaryDescription),
		author: jsonStr(json.author),
		datePublished: jsonStr(json.datePublished),
		dateModified: jsonStr(json.dateModified),
		faqs,
		schemaAudit: [],
	};
}

/** Parse the audit agent's output (drop/update decisions only). */
function parseAuditDecisions(raw: string): SchemaAuditDecision[] | null {
	const json = extractJsonObject(raw);
	if (!json || !Array.isArray(json.schemaAudit)) return null;
	return json.schemaAudit
		.map(d => {
			if (!d || typeof d !== "object") return null;
			const o = d as Record<string, unknown>;
			const nodeId = jsonStr(o.nodeId);
			const property = jsonStr(o.property);
			const action = jsonStr(o.action);
			const reason = jsonStr(o.reason);
			if (!nodeId || !property || (action !== "drop" && action !== "update") || !reason) return null;
			const base: SchemaAuditDecision = { nodeId, property, action, reason };
			if (action === "update" && "updatedValue" in o) base.updatedValue = o.updatedValue;
			return base;
		})
		.filter((x): x is SchemaAuditDecision => x !== null);
}

/**
 * Verify the extracted pack against the page text and drop anything not
 * supported by it. Returns the cleaned pack plus the questions that had to be
 * dropped (page doesn't answer them) so the caller can recommend content.
 */
function groundPack(pack: ContentPack, pageText: string): { pack: ContentPack; ungroundedQuestions: string[] } {
	if (!pageText) return { pack, ungroundedQuestions: [] }; // nothing to verify against

	const ungroundedQuestions: string[] = [];
	const faqs = pack.faqs.filter(f => {
		if (isGrounded(f.answer, pageText)) return true;
		ungroundedQuestions.push(f.question);
		return false;
	});

	// Author/date are high-risk: only keep if they actually appear on the page.
	const author = containsCI(pageText, pack.author) ? pack.author : "";
	const yearOf = (d: string) => d.match(/\d{4}/)?.[0] ?? "";
	const datePublished =
		pack.datePublished && containsCI(pageText, yearOf(pack.datePublished)) ? pack.datePublished : "";
	const dateModified = pack.dateModified && containsCI(pageText, yearOf(pack.dateModified)) ? pack.dateModified : "";

	return {
		pack: { ...pack, author, datePublished, dateModified, faqs },
		ungroundedQuestions,
	};
}

/** Deterministic content when no AI is available (existing FAQ answers only). */
function deterministicPack(report: PageGapResult, existingFaq: { question: string; answer: string }[]): ContentPack {
	return {
		metaDescription: report.target.metaDescription || "",
		organizationDescription: "",
		primaryDescription: report.target.metaDescription || "",
		author: "",
		datePublished: "",
		dateModified: "",
		faqs: existingFaq.filter(f => f.answer), // only Q&A we actually have answers for
		schemaAudit: [], // no audit without AI
	};
}

// ---------------------------------------------------------------------------
// Role resolution + graph merge — keep ONE node per page-scoped role.
//
// The page's existing JSON-LD (e.g. Yoast) already owns @ids for the WebPage,
// WebSite, Organization, BreadcrumbList and primary entity. If we mint parallel
// @ids (e.g. `${url}#webpage` while Yoast's WebPage is the bare canonical URL),
// the result is two competing nodes for one role and a disconnected graph —
// every new reference orphans. These helpers resolve the REAL existing @id for
// each role so built nodes reference it, then collapse any duplicate page-role
// nodes onto one canonical @id and union their properties.
// ---------------------------------------------------------------------------

/** Page-entity roles for a single URL — there must be exactly one. (FAQPage/QAPage excluded: rebuilt separately.) */
const PAGE_ROLE_TYPE =
	/^(WebPage|CollectionPage|AboutPage|ContactPage|ItemPage|ProfilePage|MedicalWebPage|RealEstateListing|SearchResultsPage|CheckoutPage)$/i;
const ORG_ROLE_TYPE =
	/^(Organization|LocalBusiness|Corporation|NewsMediaOrganization|OnlineBusiness|OnlineStore|Store|NGO|EducationalOrganization|GovernmentOrganization|Airline|FinancialService|Bank)$/i;

function stripUrlKey(s: string): string {
	return String(s || "")
		.replace(/[#?].*$/, "")
		.replace(/\/+$/, "")
		.toLowerCase();
}

function nodeId(o: JsonLd): string {
	return typeof o["@id"] === "string" ? (o["@id"] as string) : "";
}

function nodeMatchesUrl(o: JsonLd, url: string): boolean {
	const key = stripUrlKey(url);
	if (!key) return false;
	const u = typeof o.url === "string" ? o.url : "";
	return stripUrlKey(nodeId(o)) === key || stripUrlKey(u) === key;
}

/** Existing nodes matching a role (and optionally this URL). */
function existingByRole(existing: JsonLd[], typeRe: RegExp, url?: string): JsonLd[] {
	return existing.filter(o => {
		if (
			!typeTokens(o)
				.map(normaliseType)
				.some(t => typeRe.test(t))
		)
			return false;
		return url ? nodeMatchesUrl(o, url) : true;
	});
}

/** The @id the graph should use for a role: the page's real one if present, else `fallback`. */
function resolveRoleId(
	existing: JsonLd[],
	typeRe: RegExp,
	fallback: string,
	opts: { url?: string; preferIdSuffix?: RegExp } = {},
): string {
	const pool = existingByRole(existing, typeRe, opts.url).filter(o => nodeId(o));
	if (!pool.length) return fallback;
	if (opts.preferIdSuffix) {
		const preferred = pool.find(o => opts.preferIdSuffix!.test(nodeId(o)));
		if (preferred) return nodeId(preferred);
	}
	return nodeId(pool[0]);
}

/** Rewrite every `@id` (and `{"@id": ...}` reference) that matches an alias to its canonical value. */
function canonicalizeRoleIds(nodes: JsonLd[], aliases: Map<string, string>): JsonLd[] {
	if (!aliases.size) return nodes;
	const lower = new Map([...aliases].map(([k, v]) => [k.toLowerCase(), v]));
	const rewrite = (val: unknown): unknown => {
		if (Array.isArray(val)) return val.map(rewrite);
		if (val && typeof val === "object") {
			const out: JsonLd = {};
			for (const [k, v] of Object.entries(val as JsonLd)) {
				out[k] = k === "@id" && typeof v === "string" ? (lower.get(v.toLowerCase()) ?? v) : rewrite(v);
			}
			return out;
		}
		return val;
	};
	return nodes.map(n => rewrite(n) as JsonLd);
}

/**
 * Collapse nodes that share an `@id` into one, unioning their properties. The
 * FIRST occurrence is the merge base (existing/preserved nodes lead the array),
 * so the page's own scalar values win and our newly built nodes only FILL gaps
 * (cross-references like breadcrumb/about that the existing node lacked).
 */
function mergeGraphById(nodes: JsonLd[]): JsonLd[] {
	const order: string[] = [];
	const byKey = new Map<string, JsonLd>();
	const passthrough: JsonLd[] = [];
	for (const n of nodes) {
		if (!n || typeof n !== "object") continue;
		const id = nodeId(n);
		if (!id) {
			passthrough.push(n);
			continue;
		}
		const key = id.toLowerCase();
		const prev = byKey.get(key);
		if (!prev) {
			byKey.set(key, { ...n });
			order.push(key);
			continue;
		}
		for (const [k, v] of Object.entries(n)) {
			if (k === "@context" || k === "@id") continue;
			const cur = prev[k];
			const empty = cur === undefined || cur === null || cur === "" || (Array.isArray(cur) && cur.length === 0);
			if (empty) prev[k] = v;
		}
	}
	return [...order.map(k => byKey.get(k)!), ...passthrough];
}

// ---------------------------------------------------------------------------
// Preserved-node audit — LLM reasons about each existing property vs page text;
// two deterministic fixes handle structural graph validity (not content questions).
// ---------------------------------------------------------------------------

/** Human-readable country name from a country code/name (for areaServed). */
function countryName(country: string): string {
	const map: Record<string, string> = {
		in: "India",
		india: "India",
		us: "United States",
		usa: "United States",
		gb: "United Kingdom",
		uk: "United Kingdom",
		au: "Australia",
		australia: "Australia",
		ca: "Canada",
		canada: "Canada",
	};
	return map[country.toLowerCase()] ?? country.toUpperCase();
}

/** Derive the correct BCP-47 language subtag from the page's country. */
function langCode(country: string | null | undefined): string {
	if (!country) return "en-US";
	switch (country.toLowerCase()) {
		case "in":
		case "india":
			return "en-IN";
		case "gb":
		case "uk":
			return "en-GB";
		case "au":
		case "australia":
			return "en-AU";
		case "ca":
		case "canada":
			return "en-CA";
		default:
			return "en-US";
	}
}

/**
 * Properties that are structural/referential — they define graph topology, not
 * content claims — so the LLM must never drop or modify them.
 */
const AUDIT_SKIP = new Set([
	"@context",
	"@id",
	"@type",
	"@graph",
	"isPartOf",
	"breadcrumb",
	"publisher",
	"provider",
	"mainEntityOfPage",
	"itemListElement",
	"url",
	"name",
	"headline",
]);

/**
 * Render the content-carrying (auditable) properties of each preserved node as
 * a compact block for the LLM audit prompt. Structural/reference properties are
 * excluded so the model only reasons about content claims.
 */
function serializeForAudit(nodes: JsonLd[]): string {
	const lines: string[] = [];
	for (const o of nodes) {
		const id = nodeId(o);
		const types = typeTokens(o).map(normaliseType).join(", ");
		const auditable: JsonLd = {};
		for (const [k, v] of Object.entries(o)) {
			if (AUDIT_SKIP.has(k)) continue;
			if (v === null || v === undefined || v === "") continue;
			auditable[k] = v;
		}
		if (!Object.keys(auditable).length) continue;
		lines.push(`NODE ${id || types} [${types}]`);
		for (const [k, v] of Object.entries(auditable)) {
			const s = JSON.stringify(v);
			lines.push(`  ${k}: ${s.length > 200 ? `${s.slice(0, 200)}…` : s}`);
		}
	}
	return lines.join("\n") || "(no auditable properties)";
}

/**
 * Apply model-driven audit decisions plus two deterministic structural fixes to
 * the preserved nodes before they are merged with freshly built nodes.
 *
 * Deterministic (not content questions):
 *  1. `inLanguage` — always normalised to the correct locale from `report.country`.
 *  2. `WebPage.mainEntity` — cleared when pointing to an ItemList; the freshly
 *     built WebPage connector sets the correct primary-entity target instead.
 *
 * LLM-driven (everything else):
 *  The model sees each preserved node's content-carrying properties against the
 *  page text and returns drop/update decisions. Omit = keep.
 */
function applySchemaAudit(nodes: JsonLd[], decisions: SchemaAuditDecision[], lang: string): JsonLd[] {
	// Index decisions by canonical node @id
	const byNode = new Map<string, SchemaAuditDecision[]>();
	for (const d of decisions) {
		const key = d.nodeId.toLowerCase();
		if (!byNode.has(key)) byNode.set(key, []);
		byNode.get(key)!.push(d);
	}

	// Collect ItemList @ids for the structural mainEntity fix
	const itemListIds = new Set(
		nodes
			.filter(o =>
				typeTokens(o)
					.map(normaliseType)
					.some(t => /^ItemList$/i.test(t)),
			)
			.map(nodeId)
			.filter(Boolean),
	);

	return nodes.map(o => {
		const node: JsonLd = { ...o };
		const id = nodeId(o).toLowerCase();
		const decs = byNode.get(id) ?? [];
		const types = typeTokens(o).map(normaliseType);

		// 1. Deterministic: normalise inLanguage from report.country
		if (typeof node.inLanguage === "string") node.inLanguage = lang;

		// 2. Deterministic: WebPage.mainEntity structural fix
		if (types.some(t => PAGE_ROLE_TYPE.test(t))) {
			const me = node.mainEntity as JsonLd | undefined;
			const meId = typeof me?.["@id"] === "string" ? (me["@id"] as string) : "";
			if (meId && itemListIds.has(meId)) delete node.mainEntity;
		}

		// 3. LLM-driven decisions
		for (const d of decs) {
			if (AUDIT_SKIP.has(d.property)) continue; // never touch structural props
			if (d.property.includes(":")) {
				// e.g. "potentialAction:CommentAction" — drop only that action type from array
				const [arrayProp, targetType] = d.property.split(":");
				if (d.action === "drop" && Array.isArray(node[arrayProp])) {
					const kept = (node[arrayProp] as JsonLd[]).filter(
						a => !typeTokens(a).some(t => t.toLowerCase() === targetType.toLowerCase()),
					);
					if (kept.length) node[arrayProp] = kept;
					else delete node[arrayProp];
				}
			} else if (d.action === "drop") {
				delete node[d.property];
			} else if (d.action === "update" && d.updatedValue !== undefined) {
				node[d.property] = d.updatedValue;
			}
		}

		return node;
	});
}

// ---------------------------------------------------------------------------
// Typed builders (schema-dts) — standards-correct BY CONSTRUCTION.
// ---------------------------------------------------------------------------

export function buildGraph(
	report: PageGapResult,
	plan: SchemaPlan,
	pack: ContentPack,
	existing: JsonLd[] = [],
): {
	objects: WithContext<Thing>[];
	faqQuestions: string[];
	idAliases: Map<string, string>;
	genericRecommendations: SchemaRecommendation[];
} {
	const t = report.target.features;
	const url = report.target.finalUrl || report.targetUrl;
	const origin = originOf(url) || url;
	const brand = brandFromDomain(report.target.domain || t.domain);
	const name = report.target.title || t.title || t.h1Text || report.keyword;
	const lang = langCode(report.country);

	// Resolve each page-scoped role to the page's REAL existing @id when present,
	// so built nodes reference it instead of minting a parallel, orphaning @id.
	const ID = {
		org: resolveRoleId(existing, ORG_ROLE_TYPE, `${origin}/#organization`, { preferIdSuffix: /#organization$/i }),
		site: resolveRoleId(existing, /^WebSite$/i, `${origin}/#website`),
		page: resolveRoleId(existing, PAGE_ROLE_TYPE, `${url}#webpage`, { url }),
		primary: resolveRoleId(existing, new RegExp(`^${plan.primary}$`, "i"), `${url}#${plan.primary.toLowerCase()}`, {
			url,
		}),
		breadcrumb: resolveRoleId(existing, /^BreadcrumbList$/i, `${url}#breadcrumb`, { url }),
		faq: `${url}#faqpage`,
	};
	const ctx = "https://schema.org" as const;
	const objects: WithContext<Thing>[] = [];
	const add = (x: string) => plan.added.some(a => a.toLowerCase() === x.toLowerCase());

	// Any page-role node the page already owns. We must not emit a second one
	// (even under a different subtype, e.g. CollectionPage vs WebPage), and any
	// duplicate page-role nodes already in the existing graph get folded onto
	// this canonical @id.
	const existingPageNodes = existingByRole(existing, PAGE_ROLE_TYPE, url).filter(o => nodeId(o));
	const pageRoleExists = existingPageNodes.length > 0;
	const idAliases = new Map<string, string>();
	for (const o of existingPageNodes) {
		const pid = nodeId(o);
		if (pid && pid.toLowerCase() !== ID.page.toLowerCase()) idAliases.set(pid, ID.page);
	}

	if (add("Organization")) {
		const org: WithContext<Organization> = {
			"@context": ctx,
			"@type": "Organization",
			"@id": ID.org,
			name: brand,
			url: origin,
			...(pack.organizationDescription ? { description: pack.organizationDescription } : {}),
		};
		objects.push(org);
	}

	if (add("WebSite")) {
		const site: WithContext<WebSite> = {
			"@context": ctx,
			"@type": "WebSite",
			"@id": ID.site,
			name: brand,
			url: origin,
			publisher: { "@id": ID.org },
			inLanguage: lang,
		};
		objects.push(site);
	}

	if (add("WebPage") && !pageRoleExists) {
		const page: WithContext<WebPage> = {
			"@context": ctx,
			"@type": "WebPage",
			"@id": ID.page,
			url,
			name,
			...(pack.metaDescription ? { description: pack.metaDescription } : {}),
			isPartOf: { "@id": ID.site },
			inLanguage: lang,
			...(plan.recommended.includes("BreadcrumbList") ? { breadcrumb: { "@id": ID.breadcrumb } } : {}),
		};
		objects.push(page);
	} else if (pageRoleExists) {
		// Don't duplicate the page node — emit a thin connector that fills gaps
		// the existing node lacked: breadcrumb link and the correct mainEntity
		// (primary product/article entity, not an ItemList). applySchemaAudit
		// already cleared any wrong mainEntity, so mergeGraphById will fill from here.
		objects.push({
			"@context": ctx,
			"@type": "WebPage",
			"@id": ID.page,
			mainEntity: { "@id": ID.primary },
			...(plan.recommended.includes("BreadcrumbList") ? { breadcrumb: { "@id": ID.breadcrumb } } : {}),
		} as WithContext<WebPage>);
	}

	// Primary entity
	const desc = pack.primaryDescription || pack.metaDescription;
	if (add("Service")) {
		const svc: WithContext<Service> = {
			"@context": ctx,
			"@type": "Service",
			"@id": ID.primary,
			name,
			...(desc ? { description: desc } : {}),
			serviceType: report.promptFinder?.topic || report.keyword,
			provider: { "@id": ID.org },
			...(report.country ? { areaServed: report.country.toUpperCase() } : {}),
		};
		objects.push(svc);
	} else if (add("Article") || add("NewsArticle")) {
		const art: WithContext<Article | NewsArticle> = {
			"@context": ctx,
			"@type": add("NewsArticle") ? "NewsArticle" : "Article",
			"@id": ID.primary,
			headline: name,
			...(desc ? { description: desc } : {}),
			// Author/date only when extracted-and-grounded from the page (pack is verified).
			...(pack.author ? { author: { "@type": "Person", name: pack.author } } : {}),
			...(pack.datePublished ? { datePublished: pack.datePublished } : {}),
			...(pack.dateModified ? { dateModified: pack.dateModified } : {}),
			mainEntityOfPage: { "@id": ID.page },
			publisher: { "@id": ID.org },
			inLanguage: lang,
		};
		objects.push(art);
	} else if (add("WebApplication")) {
		const app: WithContext<WebApplication> = {
			"@context": ctx,
			"@type": "WebApplication",
			"@id": ID.primary,
			name,
			...(desc ? { description: desc } : {}),
			applicationCategory: "BusinessApplication",
			url,
		};
		objects.push(app);
	} else if (add("CollectionPage")) {
		const col: WithContext<CollectionPage> = {
			"@context": ctx,
			"@type": "CollectionPage",
			"@id": ID.primary,
			name,
			...(desc ? { description: desc } : {}),
			url,
		};
		objects.push(col);
	}

	// Breadcrumb
	if (add("BreadcrumbList")) {
		const items = breadcrumbItems(url);
		if (items.length >= 2) {
			const itemListElement: ListItem[] = items.map((it, idx) => ({
				"@type": "ListItem",
				position: idx + 1,
				name: it.name,
				item: it.item,
			}));
			const bc: WithContext<BreadcrumbList> = {
				"@context": ctx,
				"@type": "BreadcrumbList",
				"@id": ID.breadcrumb,
				itemListElement,
			};
			objects.push(bc);
		}
	}

	// FAQ — built from the content pack (which already merged page FAQ + prompts).
	let faqQuestions: string[] = [];
	if (plan.recommended.includes("FAQPage") && pack.faqs.length) {
		const mainEntity: Question[] = dedupeFaqs(pack.faqs).map(f => ({
			"@type": "Question",
			name: f.question,
			acceptedAnswer: { "@type": "Answer", text: f.answer },
		}));
		if (mainEntity.length) {
			const faq: WithContext<FAQPage> = {
				"@context": ctx,
				"@type": "FAQPage",
				"@id": ID.faq,
				mainEntity,
			};
			objects.push(faq);
			faqQuestions = mainEntity.map(q => String(q.name));
		}
	}

	// ---- Generic registry-driven pass -----------------------------------
	// Emit any planned 'added' type the explicit builders above don't handle,
	// straight from its registry SchemaSpec. This makes the schema SET the
	// generator's source of truth: anything the plan declares gets built.
	// Non-pageGated properties are filled deterministically; pageGated (page-fact)
	// properties are filled only when we have a grounded value, otherwise the
	// property is dropped and surfaced as a content recommendation (never faked).
	const genericRecommendations: SchemaRecommendation[] = [];
	const EXPLICITLY_BUILT = new Set(
		[
			"Organization",
			"WebSite",
			"WebPage",
			"Service",
			"Article",
			"NewsArticle",
			"WebApplication",
			"CollectionPage",
			"BreadcrumbList",
			"FAQPage",
			"Person", // emitted inline as Article.author, never as a thin standalone node
		].map(s => s.toLowerCase()),
	);
	const topic = report.promptFinder?.topic || report.keyword;
	const resolveProp = (p: PropertySpec): unknown => {
		switch (p.source) {
			case "derived.brand":
				return brand;
			case "derived.topic":
				return topic || undefined;
			case "page.origin":
				return origin;
			case "page.url":
				return url;
			case "page.title":
				return name;
			case "page.h1":
				return t.h1Text || undefined;
			case "page.metaDescription":
				return pack.metaDescription || undefined;
			case "config.language":
				return lang;
			case "config.country":
				if (!report.country) return undefined;
				return p.name === "areaServed"
					? { "@type": "Country", name: countryName(report.country) }
					: countryName(report.country);
			case "constant":
				if (p.constValue !== undefined) return p.constValue;
				if (p.name === "provider" || p.name === "publisher") return { "@id": ID.org };
				if (p.name === "isPartOf") return { "@id": ID.site };
				if (p.name === "mainEntityOfPage") return { "@id": ID.page };
				return undefined;
			case "page.body.extract":
				// The only extracted values the content pack carries generically are
				// the description and the author byline; every other page-fact (rates,
				// ingredients, dosage, …) we never fabricate — route to a recommendation.
				if (p.name === "description") return pack.primaryDescription || pack.metaDescription || undefined;
				if (p.name === "author") return pack.author ? { "@type": "Person", name: pack.author } : undefined;
				return undefined;
			default:
				return undefined;
		}
	};

	for (const typeName of plan.added) {
		const c = canonicalType(typeName);
		if (!c || EXPLICITLY_BUILT.has(c.toLowerCase())) continue;
		const spec = getSpec(c);
		if (!spec) continue; // not in the registry → don't fabricate a builder
		const node: JsonLd = { "@context": ctx, "@type": spec.type, "@id": `${url}#${spec.type.toLowerCase()}` };
		for (const p of spec.properties) {
			const v = resolveProp(p);
			const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
			if (!empty) {
				node[p.name] = v;
			} else if (p.pageGated && (p.requirement === "required" || p.requirement === "recommended")) {
				genericRecommendations.push({
					type: spec.type,
					field: p.name,
					reason: `${spec.type}.${p.name} (${p.requirement}) needs a real on-page value${p.note ? ` — ${p.note}` : ""}.`,
					action: `Add ${p.name} (${p.expects}) as visible content on the page, then regenerate so it can be marked up.`,
				});
			}
		}
		objects.push(node as unknown as WithContext<Thing>);
	}

	return { objects, faqQuestions, idAliases, genericRecommendations };
}

// ---------------------------------------------------------------------------
// GUARDRAILS — deep sanitisation + JSON round-trip gate.
// ---------------------------------------------------------------------------

function sanitizeValue(v: unknown): unknown {
	if (v === null || v === undefined) return undefined;
	if (typeof v === "string") {
		const s = v.trim();
		return s ? s : undefined;
	}
	if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
	if (typeof v === "boolean") return v;
	if (Array.isArray(v)) {
		const arr = v.map(sanitizeValue).filter(x => x !== undefined);
		return arr.length ? arr : undefined;
	}
	if (typeof v === "object") {
		const o = sanitizeObject(v as JsonLd);
		return Object.keys(o).length ? o : undefined;
	}
	return undefined; // functions / symbols / bigint
}

function sanitizeObject(o: JsonLd): JsonLd {
	const out: JsonLd = {};
	for (const [k, val] of Object.entries(o)) {
		if (k === "@context") continue; // re-added at top level only
		const sv = sanitizeValue(val);
		if (sv !== undefined) out[k] = sv;
	}
	return out;
}

export function validateJsonLd(value: unknown): JsonLd[] {
	let items: unknown[] = [];
	if (Array.isArray(value)) items = value;
	else if (value && typeof value === "object") {
		const o = value as JsonLd;
		items = Array.isArray(o["@graph"]) ? (o["@graph"] as unknown[]) : [o];
	}

	const out: JsonLd[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const raw = item as JsonLd;
		const tokens = typeTokens(raw);
		if (!tokens.length) continue;
		const clean = sanitizeObject(raw);
		if (!clean["@type"]) continue;
		const id = String(clean["@id"] ?? clean.name ?? clean.headline ?? clean.url ?? "");
		const key = `${tokens.join(",").toLowerCase()}|${id.toLowerCase()}`;
		if (key.trim() !== "|" && seen.has(key)) continue;
		seen.add(key);
		out.push({ "@context": "https://schema.org", ...clean });
	}

	try {
		JSON.parse(JSON.stringify(out)); // final gate
	} catch {
		return [];
	}
	return out;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function generatePageSchema(
	report: PageGapResult,
	opts: { promptFinder?: PromptFinderResult | null } = {},
): Promise<SchemaResult> {
	const promptFinder = opts.promptFinder ?? report.promptFinder ?? null;

	// 1. Preserve: existing JSON-LD, minus FAQPage (we rebuild an enriched one).
	const existingAll = validateJsonLd(extractExistingJsonLd(report.target.html));
	const existingFaq = extractExistingFaq(existingAll);
	const existingPreserved = existingAll.filter(o => !typeTokens(o).some(tk => /faqpage/i.test(tk)));

	// 2. Plan + qualified prompts + readable page text (the extraction source).
	const plan = buildSchemaPlan(report, existingAll);
	const qualifiedPrompts = selectQualifiedPrompts(promptFinder);
	const pageText = extractReadableText(report.target.html);

	const lang = langCode(report.country);

	const assemble = (
		pack: ContentPack,
		source: "ai" | "deterministic",
		model: string | null,
		warnings: string[],
	): SchemaResult => {
		// Apply LLM-driven audit decisions + two deterministic structural fixes
		// (inLanguage normalisation and ItemList mainEntity clearance) to the
		// preserved nodes before building and merging.
		const cleanedPreserved = applySchemaAudit(existingPreserved, pack.schemaAudit, lang);
		const { objects, faqQuestions, idAliases, genericRecommendations } = buildGraph(
			report,
			plan,
			pack,
			cleanedPreserved,
		);
		// Collapse any duplicate page-role @ids in the existing graph onto one
		// canonical id, then merge by @id so each role is a single connected node.
		// Preserved blocks lead (merge base), then the freshly built/typed objects.
		const base = canonicalizeRoleIds(cleanedPreserved, idAliases);
		const merged = validateJsonLd(mergeGraphById([...base, ...(objects as unknown as JsonLd[])]));
		const types = [...new Set(merged.flatMap(typeTokens))];
		const emittedQ = new Set(faqQuestions.map(q => q.toLowerCase()));
		const promptQuestions = qualifiedPrompts
			.map(p => ensureQuestion(p.prompt))
			.filter(q => emittedQ.has(q.toLowerCase()));

		// Recommendations: what competitor/SERP study wants but the page can't
		// currently support — surfaced as content tasks, NEVER fabricated.
		const recommendations: SchemaRecommendation[] = [];
		// Page-fact properties the industry/gap-driven types need but the page
		// doesn't yet state (e.g. LoanOrCredit.annualPercentageRate) — content
		// tasks, never fabricated.
		recommendations.push(...genericRecommendations);
		for (const p of qualifiedPrompts) {
			const q = ensureQuestion(p.prompt);
			if (emittedQ.has(q.toLowerCase())) continue;
			recommendations.push({
				type: "FAQPage",
				field: "mainEntity",
				reason: `GEO prompt "${p.prompt}" (${p.intent}) — the page should be citable for this but does not answer it on-page yet.`,
				action: `Add a concise, answer-first passage answering "${p.prompt}"; it will then be marked up as an FAQ entry.`,
				question: q,
			});
		}
		if (plan.recommended.includes("FAQPage") && faqQuestions.length === 0) {
			recommendations.push({
				type: "FAQPage",
				reason: "Ranking pages use FAQ structure but this page exposes no answerable Q&A to mark up.",
				action: "Add a short FAQ/Q&A section answering the top questions for this topic, then regenerate.",
			});
		}
		if ((plan.primary === "Article" || plan.primary === "NewsArticle") && !pack.author) {
			recommendations.push({
				type: plan.primary,
				field: "author",
				reason: "No author byline detectable on the page; AI engines weigh named authorship for E-E-A-T.",
				action:
					"Add a visible author byline (ideally linking to an author bio) so it can be marked up as author/Person.",
			});
		}
		if (plan.primary === "NewsArticle" && !pack.datePublished) {
			recommendations.push({
				type: "NewsArticle",
				field: "datePublished",
				reason: "No publish date detectable; news/Top Stories surfaces weigh recency.",
				action: "Show a visible published date on the page so datePublished can be marked up.",
			});
		}

		const rationale =
			(existingPreserved.length
				? `Preserved ${existingPreserved.length} existing block(s) (${plan.existingTypes.filter(x => !/faqpage/i.test(x)).join(", ") || "—"}). `
				: "No reusable existing JSON-LD on the page. ") +
			(plan.added.length ? `Added ${plan.added.join(", ")}. ` : "") +
			(faqQuestions.length
				? `FAQPage carries ${faqQuestions.length} Q&A${promptQuestions.length ? ` (incl. ${promptQuestions.length} GEO prompt(s))` : ""}. `
				: "") +
			(recommendations.length
				? `${recommendations.length} content recommendation(s) for gaps the page can't yet support. `
				: "") +
			plan.reasons.join(" ");
		return {
			jsonld: merged,
			types,
			existingTypes: plan.existingTypes,
			addedTypes: plan.added,
			recommendedTypes: plan.recommended,
			rationale,
			competitorSchemaTypes: plan.competitorSchemaTypes,
			gapSignals: plan.gapSignals,
			faqFromPrompts: promptQuestions,
			recommendations: recommendations.slice(0, 30),
			source,
			model,
			warnings,
			generatedAt: new Date().toISOString(),
		};
	};

	// Re-attach the page's real existing FAQ answers (page-truth, safe). Near-dup
	// collapsing happens once in buildGraph via dedupeFaqs, which keeps the
	// best-quality variant of each question — so we simply concatenate here.
	const withExistingFaq = (pack: ContentPack): ContentPack => {
		const faqs = [...pack.faqs];
		for (const ef of existingFaq) {
			if (!ef.answer) continue;
			faqs.push({ question: ensureQuestion(ef.question), answer: ef.answer });
		}
		return { ...pack, faqs };
	};

	const avail = await aiAvailability();
	if (!avail.available) {
		const warnings = [
			"No AI model connected — descriptions and extracted FAQ answers are omitted (only existing on-page FAQ answers were kept). Connect a Local LLM, OpenAI, or Anthropic key and regenerate to extract the remaining page content.",
		];
		return assemble(withExistingFaq(deterministicPack(report, existingFaq)), "deterministic", null, warnings);
	}

	// Two independent agents replace the old single dump: extraction (grounded
	// page facts) and existing-schema audit (drop/update decisions). Each parses,
	// validates and retries on its own, so one failing can't lose the other.
	const warnings: string[] = [];
	let pack: ContentPack;
	let source: "ai" | "deterministic" = "ai";
	try {
		const extraction = await runAgent<ContentPack>({
			name: "schema-extraction",
			system: SYSTEM_EXTRACT,
			prompt: buildExtractionPrompt(report, plan, pageText, existingFaq, qualifiedPrompts),
			maxTokens: 3000,
			timeoutMs: 180000,
			parse: parseExtraction,
		});
		if (extraction.ok) {
			pack = extraction.value;
		} else {
			pack = deterministicPack(report, existingFaq);
			source = "deterministic";
			warnings.push(
				"AI extraction could not be parsed (after a corrective retry); returned standards-valid schema with existing content only.",
			);
		}
	} catch (e) {
		return assemble(withExistingFaq(deterministicPack(report, existingFaq)), "deterministic", avail.label ?? null, [
			`AI request failed: ${(e as Error).message}. Returned standards-valid schema with existing content only.`,
		]);
	}

	// The audit agent only runs when the existing schema actually carries
	// auditable content claims — zero AI spent otherwise.
	const auditBlock = serializeForAudit(existingPreserved);
	if (existingPreserved.length && auditBlock !== "(no auditable properties)") {
		try {
			const audit = await runAgent<SchemaAuditDecision[]>({
				name: "schema-audit",
				system: SYSTEM_AUDIT,
				prompt: buildAuditPrompt(report, pageText, existingPreserved),
				maxTokens: 2000,
				timeoutMs: 180000,
				parse: parseAuditDecisions,
			});
			if (audit.ok) pack = { ...pack, schemaAudit: audit.value };
			else
				warnings.push(
					"Existing-schema audit could not be parsed (after a corrective retry) — existing schema properties were kept as-is.",
				);
		} catch {
			warnings.push("Existing-schema audit request failed — existing schema properties were kept as-is.");
		}
	}

	emitAgentEvent({
		agent: "pipeline",
		phase: "note",
		attempt: 0,
		detail: "Grounding extracted values against the page text, then assembling the typed JSON-LD graph…",
	});
	if (source === "deterministic")
		return assemble(withExistingFaq(pack), "deterministic", avail.label ?? null, warnings);

	// Verify every extracted value against the page text; drop the ungrounded.
	const { pack: grounded } = groundPack(pack, pageText);
	if (!pageText) warnings.push("Page text could not be extracted — extracted fields were not grounded-checked.");
	return assemble(withExistingFaq(grounded), "ai", avail.label ?? "ai", warnings);
}

// ---------------------------------------------------------------------------
// On-demand content drafting for "Content needed" recommendations.
//
// Drafts FAQ answers GROUNDED in the page's existing text — the LLM may
// rephrase/combine what the page says but may NOT introduce new facts. Grounded
// drafts come back as page copy to PUBLISH (plus the matching FAQPage JSON-LD,
// gated behind a "publish on the page first" clause). Questions the page can't
// support are returned as `unanswerable` so the user supplies the facts.
// ---------------------------------------------------------------------------

export type ContentDraft = { question: string; answer: string };

export type DraftContentResult = {
	drafts: ContentDraft[];
	/** Questions the page lacks the facts to answer — never fabricated. */
	unanswerable: string[];
	/** FAQPage JSON-LD built from the grounded drafts (deploy AFTER publishing copy). */
	faqJsonld: JsonLd[];
	source: "ai";
	model: string | null;
	warnings: string[];
};

const SYSTEM_DRAFT = `You are a GEO/SEO content writer drafting FAQ answers that will be PUBLISHED ON THE PAGE itself. You are given the readable TEXT of one web page and a numbered list of questions the page should answer.

RULES:
- Build each answer from what the SOURCE TEXT says. You MAY synthesize and combine information from anywhere in the source — you do NOT need a single verbatim sentence, and the wording can be original. But you must NOT introduce a specific FIGURE (number, amount, rate, fee, percentage, date, age, tenure) or a NAMED entity that does not appear in the SOURCE TEXT.
- Only return "" for a question if the source has nothing relevant to it at all. If the source covers the topic, write a helpful answer-first response of 2–4 sentences.
- Echo each question's "id" exactly so the answer maps back to its question.
- Output a single valid JSON object only: { "answers": [ { "id": <number>, "answer": "<answer or "">" } ] } — no markdown, no commentary.`;

type DraftAnswerRow = { id: number; answer: string };

function parseDraftAnswers(raw: string): DraftAnswerRow[] {
	const cleaned = raw.replace(/```(?:json)?/gi, "");
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return [];
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return [];
	}
	const arr = Array.isArray(json.answers) ? json.answers : [];
	const out: DraftAnswerRow[] = [];
	arr.forEach((a, idx) => {
		if (!a || typeof a !== "object") return;
		const o = a as Record<string, unknown>;
		const answer = typeof o.answer === "string" ? o.answer.trim() : "";
		// Prefer an explicit numeric id; fall back to 1-based array order.
		const parsed = typeof o.id === "number" ? o.id : Number.parseInt(String(o.id ?? ""), 10);
		out.push({ id: Number.isFinite(parsed) && parsed > 0 ? parsed : idx + 1, answer });
	});
	return out;
}

/** Digit groups (commas stripped) — used to block invented figures in drafts. */
function numberTokens(s: string): Set<string> {
	const out = new Set<string>();
	for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(m[0].replace(/,/g, ""));
	return out;
}

/**
 * Grounding for DRAFTED prose. Unlike extraction grounding (near-verbatim), this
 * allows original wording / synthesis but rejects any specific figure not present
 * in the source corpus — the real YMYL risk — and keeps a loose lexical-overlap
 * floor so the answer is actually about the page.
 */
function isDraftGrounded(answer: string, corpus: string): boolean {
	const aTokens = normTokens(answer);
	if (aTokens.length < 3) return false;
	const corpusNumbers = numberTokens(corpus);
	for (const n of numberTokens(answer)) if (!corpusNumbers.has(n)) return false; // invented figure
	const page = new Set(normTokens(corpus));
	const hits = aTokens.filter(w => page.has(w)).length;
	return hits / aTokens.length >= 0.4;
}

export async function draftRecommendedContent(
	report: PageGapResult,
	questions: string[],
	_opts: { promptFinder?: PromptFinderResult | null } = {},
): Promise<DraftContentResult> {
	const wanted = [...new Set(questions.map(q => q.trim()).filter(Boolean))].slice(0, 20);
	const empty: DraftContentResult = {
		drafts: [],
		unanswerable: wanted,
		faqJsonld: [],
		source: "ai",
		model: null,
		warnings: [],
	};
	if (!wanted.length) return { ...empty, unanswerable: [] };

	const avail = await aiAvailability();
	if (!avail.available)
		return {
			...empty,
			warnings: ["No AI model connected — connect a Local LLM, OpenAI, or Anthropic key to draft content."],
		};

	// Grounding corpus: visible page text + the page's OWN existing FAQ answers
	// (page-truth that lives in JSON-LD, which extractReadableText strips out) +
	// the meta description. This is also the source we give the model to draft from.
	const pageText = extractReadableText(report.target.html);
	const existing = validateJsonLd(extractExistingJsonLd(report.target.html));
	const existingFaqText = extractExistingFaq(existing)
		.map(f => `${f.question} ${f.answer}`)
		.join(" ");
	const corpus = `${pageText} ${existingFaqText} ${report.target.metaDescription || ""}`.replace(/\s+/g, " ").trim();
	if (!corpus)
		return {
			...empty,
			model: avail.label ?? null,
			warnings: ["Page text could not be extracted; cannot ground any draft."],
		};

	const sourceText = corpus.slice(0, 18000);
	const prompt = `PAGE TYPE: ${report.intent.targetPageType}
BRAND: ${brandFromDomain(report.target.domain || report.target.features.domain)}

===== SOURCE TEXT (the ONLY source you may use) =====
${sourceText}
===== END SOURCE TEXT =====

QUESTIONS TO ANSWER (return "" only if the source has nothing relevant; keep each answer with its id):
${wanted.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;

	let rows: DraftAnswerRow[] = [];
	try {
		const res = await runAgent<DraftAnswerRow[]>({
			name: "content-drafter",
			system: SYSTEM_DRAFT,
			prompt,
			maxTokens: 4000,
			timeoutMs: 180000,
			parse: raw => {
				const parsed = parseDraftAnswers(raw);
				return parsed.length ? parsed : null;
			},
		});
		if (!res.ok) {
			return {
				...empty,
				model: avail.label ?? null,
				warnings: ["AI drafting output could not be parsed (after a corrective retry)."],
			};
		}
		rows = res.value;
	} catch (e) {
		return { ...empty, model: avail.label ?? null, warnings: [`AI request failed: ${(e as Error).message}.`] };
	}

	// Match answers back to questions by id/position — robust to the model
	// rephrasing the question grammar when it echoes it.
	const byId = new Map(rows.map(r => [r.id, r.answer]));

	const drafts: ContentDraft[] = [];
	const unanswerable: string[] = [];
	wanted.forEach((q, idx) => {
		const answer = (byId.get(idx + 1) ?? "").trim();
		// Keep answers grounded in the corpus; synthesis is allowed, invented figures are not.
		if (answer && isDraftGrounded(answer, corpus)) drafts.push({ question: ensureQuestion(q), answer });
		else unanswerable.push(q);
	});

	const mainEntity: Question[] = drafts.map(d => ({
		"@type": "Question",
		name: d.question,
		acceptedAnswer: { "@type": "Answer", text: d.answer },
	}));
	const faqJsonld = mainEntity.length
		? validateJsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity } as unknown as JsonLd)
		: [];

	const warnings: string[] = [];
	if (report.promptFinder?.isYmyl)
		warnings.push(
			"YMYL topic — have a qualified expert verify every rate, fee, eligibility, and legal claim before publishing this copy.",
		);

	return { drafts, unanswerable, faqJsonld, source: "ai", model: avail.label ?? "ai", warnings };
}
