/**
 * Page Gap Analyzer — deterministic engine (no LLM).
 *
 * Three responsibilities, all rule-based:
 *  1. Intent verdict (the 7-rule page-type framework) — runs first, as a gate.
 *  2. Benchmark dataset across the target + top 10 competitor pages.
 *  3. SERP-sourced gap engine — every gap must be evidenced by 3+ ranking pages,
 *     otherwise it is downgraded to a "best practice — not SERP-validated" note.
 *
 * Page parsing is delegated to the existing audit-engine parser
 * (analyzeRenderedHtml). This module only adds the *net-new* signals the spec
 * needs: page-type classification, conversion elements, intent logic, and the
 * cross-page gap sourcing.
 */
import type { PageAnalysis } from "@/lib/audit-engine";
import { extractHtmlSignals, type HtmlSignals } from "@/lib/page-gap-signals";

export type Severity = "critical" | "high" | "medium" | "low" | "pass";

export type GapDimension =
	| "intent_match"
	| "onpage_seo"
	| "content_quality"
	| "eeat"
	| "conversion"
	| "internal_linking"
	| "structured_data"
	| "geo_readiness";

export type PageType =
	| "product_service"
	| "blog_guide"
	| "category"
	| "tool"
	| "forum"
	| "news"
	| "comparison"
	| "hybrid"
	| "unknown";

export type ConversionSignals = {
	ctaTexts: string[];
	hasInlineCta: boolean;
	hasStickyCta: boolean;
	hasCalculator: boolean;
	hasForm: boolean;
	ctaWeak: boolean;
	strongCtaCount: number;
	priceSignals: number;
};

/**
 * Bullet-proof, multi-angle page-type classification result. Every angle
 * contributes points to a commercial and an informational tally; the verdict
 * and a 0–100 confidence number are derived from those tallies, so the page
 * type is always backed by an explainable score (never a single heuristic).
 */
export type PageTypeScore = {
	type: PageType;
	/** 0–100 weight of commercial / transactional signals. */
	commercial: number;
	/** 0–100 weight of informational / editorial signals. */
	informational: number;
	/** 0–100 confidence in the resolved type. */
	confidence: number;
	/** Human-readable signals that fired, for transparency in the UI/export. */
	signals: string[];
};

export type PageFeatures = {
	rank: number; // 0 = target, 1..10 = SERP positions
	url: string;
	domain: string;
	ok: boolean;
	pageType: PageType;
	pageTypeScore: PageTypeScore;
	title: string;
	titleLength: number;
	metaDescription: string;
	h1Text: string;
	h1Count: number;
	h2Count: number;
	h3Count: number;
	wordCount: number;
	schemaTypes: string[];
	canonical: string | null;
	hasFaq: boolean;
	faqQuestions: string[];
	tableCount: number;
	listCount: number;
	imageCount: number;
	imagesWithoutAlt: number;
	internalLinks: number;
	externalLinks: number;
	qualityExternalLinks: number;
	questionHeadings: number;
	statMatches: number;
	hasVideo: boolean;
	hasAuthorSignal: boolean;
	hasDateSignal: boolean;
	hasOpenGraph: boolean;
	hasViewport: boolean;
	hasLang: boolean;
	hasClientRenderRisk: boolean;
	optimalParagraphs: number;
	longParagraphs: number;
	conv: ConversionSignals;
	hasServiceInternalLink: boolean;
	hasUpdatedYear: boolean;
	hasAnswerFirst: boolean;
	hasSummaryTable: boolean;
	/** Net-new deterministic HTML signals for the SOP scorecard. */
	signals: HtmlSignals;
};

export type SerpComposition = {
	counts: Record<PageType, number>;
	commercial: number;
	informational: number;
	hybrid: number;
	comparison: number;
	total: number;
};

export type IntentVerdict = {
	ruleApplied: number;
	verdict: "service_page" | "informational" | "hybrid_required";
	verdictLabel: string;
	composition: SerpComposition;
	keyword: string;
	actionModifiers: string[];
	bareKeyword: boolean;
	ambiguousModifier: boolean;
	targetPageType: PageType;
	mismatch: boolean;
	hybridRequired: boolean;
	reason: string;
};

export type SerpEvidence = {
	rank: number;
	domain: string;
	example_value: string;
};

export type Gap = {
	id: string;
	category: string;
	dimension: GapDimension;
	title: string;
	severity: Severity;
	confidence: number;
	serp_validated: boolean;
	serp_prevalence: string;
	serp_evidence: SerpEvidence[];
	impact: string;
	evidence: Record<string, unknown>;
	why_it_matters: string;
	recommended_action: string;
	suggested_fix: string;
	owner: string;
	auto_fixable: boolean;
};

export type BenchmarkRow = {
	rank: number;
	domain: string;
	page_type: PageType;
	title_length: number;
	h1_text: string;
	word_count: number;
	h2_count: number;
	has_faq: boolean;
	has_table: boolean;
	has_calculator: boolean;
	has_inline_cta: boolean;
	has_sticky_cta: boolean;
	has_named_author: boolean;
	has_updated_date: boolean;
	schema_types: string[];
	internal_link_to_service: boolean;
	internal_body_links: number;
	faq_schema: boolean;
	breadcrumb_schema: boolean;
	geo_answer_first: boolean;
	geo_question_headings: number;
	geo_summary_table: boolean;
};

export type SubScores = Record<GapDimension, number>;

// ---------------------------------------------------------------------------
// Regex toolbox (net-new detection beyond what audit-engine already parses)
// ---------------------------------------------------------------------------

const QUESTION_WORDS = /^(who|what|when|where|why|how|is|are|can|does|do|should|will|which|was|were|has|have|did)\b/i;

const STRONG_CTA =
	/\b(apply(\s*(now|online|today|for))?|buy(\s*now)?|purchase|order(\s*now)?|add to (cart|bag|basket)|get (a |an )?(quote|started|offer|deal|estimate)|sign\s?up|register|open (an )?account|subscribe|book (now|a (demo|call|consultation))|start (now|free|your)|check (your )?eligibility|get pre-?approved|enroll|join now|download(\s*(now|the app))?|request (a |an )?(quote|demo|callback|consultation))\b/i;

const WEAK_CTA = /\b(learn more|read more|find out more|discover|explore|see more|view more|know more|more info)\b/i;

const CALC =
	/\b(calculator|calculate your|eligibility (check|checker)|emi calculator|repayment calculator|estimat(e your|or)|how much (can|do)|quiz|interactive (tool|widget))\b/i;

const SERVICE_PATH =
	/(apply|application|services?|products?|pricing|plans?|quote|buy|checkout|open-?account|get-?started|sign-?up|signup|register|book|order|subscribe|loan|credit-?card|mortgage)/i;

// URL-path tells you a lot before you even read the page. These are scored,
// not absolute, so a single token never forces a verdict on its own.
const URL_INFORMATIONAL =
	/(\/blog|\/blogs|\/article|\/articles|\/news|\/guide|\/guides|\/resources?|\/learn|\/insights?|\/how-?to|\/what-?is|\/why-|\/tips|\/post|\/posts|\/story|\/stories|\/knowledge|\/help|\/wiki|\/academy|\/tutorials?|\/advice|\/explained|\/faq|\/glossary|\/20\d\d\/)/i;

const URL_COMMERCIAL =
	/(\/product|\/products|\/service|\/services|\/pricing|\/plans?|\/apply|\/application|\/buy|\/shop|\/store|\/checkout|\/cart|\/quote|\/order|\/book|\/booking|\/sign-?up|\/signup|\/register|\/open-?account|\/loan|\/loans|\/credit-?card|\/mortgage|\/deals?|\/offers?|\/get-?started|\/subscribe|\/p\/|\/item\/|\/dp\/|\/sku)/i;

const PRICE_SIGNAL =
	/(?:[$£€₹]\s?\d|(?:\bUSD|\bEUR|\bGBP|\bINR|\bRs\.?)\s?\d|\b\d+(?:\.\d+)?\s?%\s?(?:apr|p\.?a\.?|interest)|\bper\s+(?:month|year|mo|yr)\b|\/mo\b|\/yr\b|\bfrom\s+[$£€₹]\d)/i;

const ARTICLE_SCHEMA =
	/^(article|blogposting|newsarticle|liveblogposting|techarticle|scholarlyarticle|report|howto|recipe|medicalwebpage)$/i;

const COMMERCIAL_SCHEMA =
	/^(product|individualproduct|productgroup|offer|aggregateoffer|service|financialproduct|loanorcredit|investmentorderdeposit|vehicle|car|realestatelisting|apartmentcomplex|hotel|event|course|softwareapplication)$/i;

const UGC_HOSTS =
	/(^|\.)(reddit\.com|quora\.com|stackexchange\.com|stackoverflow\.com|stackexchange|trustpilot\.com|tripadvisor\.|discourse\.|forum\.)/i;

const NEWS_HOSTS =
	/(^|\.)(nytimes\.com|bbc\.(com|co\.uk)|theguardian\.com|reuters\.com|forbes\.com|bloomberg\.com|cnbc\.com|wsj\.com|cnn\.com)/i;

const COMPARISON_WORDS = /\b(vs\.?|versus|compare|comparison|best \d+|top \d+|alternatives?)\b/i;

const ACTION_MODIFIERS: { label: string; re: RegExp }[] = [
	{ label: "apply", re: /\bapply( for| online)?\b/i },
	{ label: "buy", re: /\bbuy\b/i },
	{ label: "purchase", re: /\bpurchase\b/i },
	{ label: "order", re: /\border\b/i },
	{ label: "get", re: /\bget\b/i },
	{ label: "instant", re: /\binstant\b/i },
	{ label: "near me", re: /\bnear me\b/i },
	{ label: "sign up", re: /\bsign\s?up\b/i },
	{ label: "register", re: /\bregister\b/i },
	{ label: "open account", re: /\bopen (an )?account\b/i },
	{ label: "download", re: /\bdownload\b/i },
	{ label: "in [location]", re: /\bin\s+[a-z]{3,}/i },
];

const AMBIGUOUS_MODIFIERS = [
	{ label: "calculator", re: /\bcalculator\b/i },
	{ label: "compare", re: /\bcompare|comparison\b/i },
];

function stripInline(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./i, "");
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------------------
// Conversion-element extraction (net-new)
// ---------------------------------------------------------------------------

export function extractConversionSignals(html: string, text: string): ConversionSignals {
	const ctaTexts: string[] = [];
	const collect = (re: RegExp) => {
		let m: RegExpExecArray | null;
		while ((m = re.exec(html))) {
			const t = stripInline(m[1]);
			if (t && t.length <= 60) ctaTexts.push(t);
			if (ctaTexts.length > 200) break;
		}
	};
	collect(/<button\b[^>]*>([\s\S]*?)<\/button>/gi);
	collect(/<a\b[^>]*>([\s\S]*?)<\/a>/gi);
	// submit/aria-label CTAs
	let im: RegExpExecArray | null;
	const inputRe = /<input\b[^>]*type=["'](?:submit|button)["'][^>]*>/gi;
	while ((im = inputRe.exec(html))) {
		const v = im[0].match(/value=["']([^"']+)["']/i)?.[1];
		if (v) ctaTexts.push(v.trim());
	}

	const strongCtaCount = ctaTexts.filter(t => STRONG_CTA.test(t)).length;
	const hasInlineCta = strongCtaCount > 0;
	const ctaWeak = !hasInlineCta && ctaTexts.some(t => WEAK_CTA.test(t));
	const priceSignals = (text.match(new RegExp(PRICE_SIGNAL, "gi")) || []).length;
	const hasForm = /<form\b/i.test(html);
	const hasCalculator =
		/type=["']range["']/i.test(html) ||
		/class=["'][^"']*calculator[^"']*["']/i.test(html) ||
		(CALC.test(text) && (hasForm || /<input\b/i.test(html)));
	const stickyMarkup =
		/position\s*:\s*(sticky|fixed)/i.test(html) ||
		/class=["'][^"']*(sticky|floating|fixed)[^"']*(cta|bar|button|action)/i.test(html);
	const hasStickyCta = stickyMarkup && (hasInlineCta || ctaWeak);

	return {
		ctaTexts: Array.from(new Set(ctaTexts)).slice(0, 40),
		hasInlineCta,
		hasStickyCta,
		hasCalculator,
		hasForm,
		ctaWeak,
		strongCtaCount,
		priceSignals,
	};
}

// ---------------------------------------------------------------------------
// Page-type classification — multi-angle weighted scoring (Rule 1).
//
// The old version was a single heuristic ladder that could not tell a
// service/product page from a hybrid or a real blog. This version scores the
// page from FIVE independent angles, each of which can vote commercial and/or
// informational:
//   1. URL path tokens (/blog, /services, /apply, dated paths …)
//   2. Schema.org @type (Article/BlogPosting vs Product/Service/Offer …)
//   3. Conversion elements (strong CTAs, calculators, forms, prices)
//   4. Editorial signals (author, dates, depth, question headings, lists)
//   5. Host class (UGC/forum, news publisher)
// The two tallies and their margin produce the verdict AND a 0–100 confidence
// number, so every classification is explainable and auditable.
// ---------------------------------------------------------------------------

export function classifyPageTypeScored(a: PageAnalysis, conv: ConversionSignals): PageTypeScore {
	const url = a.finalUrl || a.url;
	let path = "";
	try {
		path = new URL(url).pathname;
	} catch {
		/* ignore */
	}
	const host = domainOf(url);
	const schema = a.schemaTypes.map(s => s.toLowerCase());
	const hasSchema = (re: RegExp) => schema.some(s => re.test(s));
	const signals: string[] = [];

	let commercial = 0;
	let informational = 0;
	const add = (bucket: "c" | "i", pts: number, why: string) => {
		if (bucket === "c") commercial += pts;
		else informational += pts;
		signals.push(`${bucket === "c" ? "🛒" : "📄"} +${pts} ${why}`);
	};

	// --- Angle 1: URL path -----------------------------------------------------
	const isHomepage = path === "/" || path === "";
	if (isHomepage) add("c", 8, "homepage/root URL (commercial-leaning)");
	if (URL_COMMERCIAL.test(path)) add("c", 26, `commercial URL path (${path})`);
	if (URL_INFORMATIONAL.test(path)) add("i", 26, `editorial URL path (${path})`);
	if (/\/20\d\d\/\d{1,2}\//.test(path) || /\/\d{4}-\d{2}-\d{2}/.test(path)) add("i", 8, "dated URL slug");
	if (/\.(html?|php|aspx)$/i.test(path) && URL_INFORMATIONAL.test(path)) add("i", 4, "article-style file URL");

	// --- Angle 2: Schema.org ---------------------------------------------------
	if (hasSchema(ARTICLE_SCHEMA)) add("i", 30, "Article/BlogPosting schema");
	if (hasSchema(COMMERCIAL_SCHEMA)) add("c", 30, "Product/Service/Offer schema");
	if (hasSchema(/^faqpage$/)) {
		add("i", 6, "FAQPage schema");
		add("c", 4, "FAQPage schema (supports hybrid)");
	}
	if (hasSchema(/^breadcrumblist$/) && URL_COMMERCIAL.test(path)) add("c", 4, "breadcrumb under commercial path");

	// --- Angle 3: Conversion elements ------------------------------------------
	if (conv.strongCtaCount >= 3) add("c", 24, `${conv.strongCtaCount} strong action CTAs`);
	else if (conv.strongCtaCount === 2) add("c", 16, "2 strong action CTAs");
	else if (conv.strongCtaCount === 1) add("c", 9, "1 strong action CTA");
	if (conv.hasCalculator) add("c", 16, "embedded calculator/tool");
	if (conv.hasStickyCta) add("c", 8, "sticky/floating CTA");
	if (conv.priceSignals >= 3) add("c", 12, `${conv.priceSignals} price/rate mentions`);
	else if (conv.priceSignals === 1 || conv.priceSignals === 2) add("c", 6, "price/rate mentions");
	if (conv.ctaWeak && conv.strongCtaCount === 0) add("i", 4, "only soft 'learn more' links");

	// --- Angle 4: Editorial / article depth ------------------------------------
	if (a.hasAuthorSignal) add("i", 12, "named author/byline");
	if (a.hasDateSignal) add("i", 8, "published/updated date");
	if (a.wordCount >= 1500) add("i", 16, `long-form depth (${a.wordCount}w)`);
	else if (a.wordCount >= 800) add("i", 11, `article-length depth (${a.wordCount}w)`);
	else if (a.wordCount >= 400) add("i", 5, `medium depth (${a.wordCount}w)`);
	else if (a.wordCount < 250) add("c", 6, `thin body copy (${a.wordCount}w)`);
	if (a.questionHeadings >= 2) add("i", 8, `${a.questionHeadings} question headings`);
	if (a.h2Texts.length >= 5) add("i", 6, `${a.h2Texts.length} H2 sections`);
	if (a.listCount >= 3) add("i", 3, "list-heavy editorial layout");

	// --- Angle 5: Host class ---------------------------------------------------
	const isForum = hasSchema(/^(qapage|discussionforumposting)$/) || UGC_HOSTS.test(host);
	const isNews = hasSchema(/^newsarticle$/) || NEWS_HOSTS.test(host);
	const isComparison = COMPARISON_WORDS.test(a.title) || COMPARISON_WORDS.test(a.h1Texts.join(" "));
	if (isComparison) add("i", 6, "comparison/listicle title");

	commercial = Math.min(100, Math.round(commercial));
	informational = Math.min(100, Math.round(informational));

	// --- Resolve type ----------------------------------------------------------
	const margin = Math.abs(commercial - informational);
	const peak = Math.max(commercial, informational);
	const HYBRID_FLOOR = 32; // both angles materially present → hybrid territory
	const DECISIVE_MARGIN = 18;

	let type: PageType;
	if (isForum) type = "forum";
	else if (isNews) type = "news";
	else if (conv.hasCalculator && commercial >= informational && a.wordCount < 700) type = "tool";
	else if (
		(hasSchema(/^(itemlist|collectionpage)$/) || (a.internalLinks > 40 && a.wordCount < 400)) &&
		commercial >= informational
	)
		type = "category";
	else if (isComparison && informational >= 30) type = "comparison";
	else if (commercial >= HYBRID_FLOOR && informational >= HYBRID_FLOOR) type = "hybrid";
	else if (commercial - informational >= DECISIVE_MARGIN) type = "product_service";
	else if (informational - commercial >= DECISIVE_MARGIN) type = "blog_guide";
	else if (peak >= HYBRID_FLOOR)
		type = "hybrid"; // close call, both present-ish
	else if (commercial > informational) type = "product_service";
	else if (informational > commercial) type = "blog_guide";
	else type = "unknown";

	// --- Confidence ------------------------------------------------------------
	// High when one angle clearly dominates with strong total signal; low when
	// the tallies are weak or near-tied (genuinely ambiguous page).
	let confidence: number;
	if (type === "hybrid") {
		confidence = Math.min(95, 45 + Math.min(commercial, informational));
	} else if (type === "unknown" || peak < 18) {
		confidence = Math.min(40, 15 + peak);
	} else {
		confidence = Math.min(98, 40 + margin + Math.round(peak * 0.25));
	}

	return { type, commercial, informational, confidence: Math.round(confidence), signals };
}

/** Back-compat thin wrapper — returns just the resolved page-type label. */
export function classifyPageType(a: PageAnalysis, conv: ConversionSignals): PageType {
	return classifyPageTypeScored(a, conv).type;
}

// ---------------------------------------------------------------------------
// Feature extraction — merges existing analysis + net-new signals
// ---------------------------------------------------------------------------

export function extractFeatures(a: PageAnalysis, rank: number): PageFeatures {
	const conv = extractConversionSignals(a.html, a.text);
	const pageTypeScore: PageTypeScore = a.ok
		? classifyPageTypeScored(a, conv)
		: { type: "unknown", commercial: 0, informational: 0, confidence: 0, signals: [] };
	const pageType = pageTypeScore.type;
	const year = String(new Date().getFullYear());
	const h1Text = a.h1Texts[0] ?? "";

	const summaries: string[] = [];
	const sumRe = /<summary\b[^>]*>([\s\S]*?)<\/summary>/gi;
	let sm: RegExpExecArray | null;
	while ((sm = sumRe.exec(a.html))) {
		const t = stripInline(sm[1]);
		if (t) summaries.push(t);
		if (summaries.length > 8) break;
	}
	const questionHeadings = [...a.h2Texts, ...a.h3Texts].filter(h => QUESTION_WORDS.test(h));
	const faqQuestions = Array.from(new Set([...questionHeadings, ...summaries]))
		.filter(Boolean)
		.slice(0, 4);

	let hasServiceInternalLink = false;
	for (const link of a.links) {
		if (link.kind !== "internal") continue;
		let path = "";
		try {
			path = new URL(link.url).pathname;
		} catch {
			/* ignore */
		}
		if (SERVICE_PATH.test(path) || STRONG_CTA.test(link.text)) {
			hasServiceInternalLink = true;
			break;
		}
	}

	const firstPara = a.paragraphWordCounts[0] ?? 0;

	return {
		rank,
		url: a.finalUrl || a.url,
		domain: domainOf(a.finalUrl || a.url),
		ok: a.ok,
		pageType,
		pageTypeScore,
		title: a.title,
		titleLength: a.title.length,
		metaDescription: a.metaDescription,
		h1Text,
		h1Count: a.h1Texts.length,
		h2Count: a.h2Texts.length,
		h3Count: a.h3Texts.length,
		wordCount: a.wordCount,
		schemaTypes: a.schemaTypes,
		canonical: a.canonical,
		hasFaq: a.hasFaqStructure || a.hasFaqSchema,
		faqQuestions,
		tableCount: a.tableCount,
		listCount: a.listCount,
		imageCount: a.imageCount,
		imagesWithoutAlt: a.imagesWithoutAlt,
		internalLinks: a.internalLinks,
		externalLinks: a.externalLinks,
		qualityExternalLinks: a.qualityExternalLinks,
		questionHeadings: questionHeadings.length,
		statMatches: a.statMatches,
		hasVideo: a.hasVideoEmbed,
		hasAuthorSignal: a.hasAuthorSignal,
		hasDateSignal: a.hasDateSignal,
		hasOpenGraph: a.hasOpenGraph,
		hasViewport: a.hasViewport,
		hasLang: a.hasLang,
		hasClientRenderRisk: a.hasClientRenderRisk,
		optimalParagraphs: a.optimalParagraphs,
		longParagraphs: a.longParagraphs,
		conv,
		hasServiceInternalLink,
		hasUpdatedYear: a.title.includes(year) || h1Text.includes(year),
		hasAnswerFirst: firstPara >= 25 && firstPara <= 130,
		hasSummaryTable: a.tableCount > 0,
		signals: extractHtmlSignals(a),
	};
}

// ---------------------------------------------------------------------------
// Intent verdict (Rules 1–7)
// ---------------------------------------------------------------------------

export function detectActionModifiers(keyword: string): {
	modifiers: string[];
	ambiguous: boolean;
} {
	const modifiers = ACTION_MODIFIERS.filter(m => m.re.test(keyword)).map(m => m.label);
	const ambiguous = AMBIGUOUS_MODIFIERS.some(m => m.re.test(keyword));
	return { modifiers, ambiguous };
}

function emptyComposition(): SerpComposition {
	const counts = {
		product_service: 0,
		blog_guide: 0,
		category: 0,
		tool: 0,
		forum: 0,
		news: 0,
		comparison: 0,
		hybrid: 0,
		unknown: 0,
	} as Record<PageType, number>;
	return { counts, commercial: 0, informational: 0, hybrid: 0, comparison: 0, total: 0 };
}

export function computeSerpComposition(competitors: PageFeatures[]): SerpComposition {
	const comp = emptyComposition();
	for (const c of competitors) {
		if (!c.ok) continue;
		comp.counts[c.pageType]++;
		comp.total++;
	}
	comp.commercial = comp.counts.product_service + comp.counts.tool + comp.counts.category;
	comp.informational = comp.counts.blog_guide + comp.counts.news;
	comp.hybrid = comp.counts.hybrid;
	comp.comparison = comp.counts.comparison;
	return comp;
}

export function computeIntentVerdict(
	keyword: string,
	competitors: PageFeatures[],
	target: PageFeatures,
): IntentVerdict {
	const composition = computeSerpComposition(competitors);
	const { modifiers, ambiguous } = detectActionModifiers(keyword);
	const total = Math.max(1, composition.total);
	// Comparison + hybrid lean commercial for the threshold test.
	const commercialLeaning = composition.commercial + composition.comparison;
	const informational = composition.informational;
	const commercialRatio = (commercialLeaning + composition.hybrid) / total;
	const informationalRatio = (informational + composition.hybrid) / total;

	let verdict: IntentVerdict["verdict"];
	if (commercialLeaning / total >= 0.7) verdict = "service_page";
	else if (informational / total >= 0.7) verdict = "informational";
	else verdict = "hybrid_required";

	const bareKeyword = modifiers.length === 0;
	const hasModifier = modifiers.length > 0;

	let ruleApplied = 2;
	if (hasModifier && verdict === "service_page") ruleApplied = 4;
	else if (verdict === "hybrid_required" && bareKeyword) ruleApplied = 3;
	else ruleApplied = 2;

	const targetPageType = target.pageType;
	const targetInformational = targetPageType === "blog_guide" || targetPageType === "news";
	const targetPureCommercial =
		targetPageType === "product_service" || targetPageType === "category" || targetPageType === "tool";

	let mismatch = false;
	if (verdict === "service_page" && targetInformational) mismatch = true;
	if (verdict === "informational" && targetPureCommercial) mismatch = true;

	const hybridRequired = verdict === "hybrid_required";

	const verdictLabel =
		verdict === "service_page"
			? "Build/maintain a service or landing page — a blog will not rank here"
			: verdict === "informational"
				? "A blog or guide can rank — a pure product page will underperform"
				: "Hybrid page required — blog structure with embedded conversion elements";

	const reason =
		`Of ${composition.total} classified ranking pages: ` +
		`${composition.commercial} product/service/landing, ${composition.informational} blog/guide, ` +
		`${composition.hybrid} hybrid, ${composition.comparison} comparison. ` +
		(hasModifier
			? `Keyword carries action modifier(s): ${modifiers.join(", ")}. `
			: `Keyword is bare (no action modifier). `) +
		`Commercial-leaning share ≈ ${Math.round(commercialRatio * 100)}%, informational share ≈ ${Math.round(informationalRatio * 100)}%.`;

	return {
		ruleApplied,
		verdict,
		verdictLabel,
		composition,
		keyword,
		actionModifiers: modifiers,
		bareKeyword,
		ambiguousModifier: ambiguous,
		targetPageType,
		mismatch,
		hybridRequired,
		reason,
	};
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

function toBenchmarkRow(f: PageFeatures): BenchmarkRow {
	const schema = f.schemaTypes.map(s => s.toLowerCase());
	return {
		rank: f.rank,
		domain: f.domain,
		page_type: f.pageType,
		title_length: f.titleLength,
		h1_text: f.h1Text,
		word_count: f.wordCount,
		h2_count: f.h2Count,
		has_faq: f.hasFaq,
		has_table: f.tableCount > 0,
		has_calculator: f.conv.hasCalculator,
		has_inline_cta: f.conv.hasInlineCta,
		has_sticky_cta: f.conv.hasStickyCta,
		has_named_author: f.hasAuthorSignal,
		has_updated_date: f.hasDateSignal,
		schema_types: f.schemaTypes,
		internal_link_to_service: f.hasServiceInternalLink,
		internal_body_links: f.internalLinks,
		faq_schema: schema.includes("faqpage"),
		breadcrumb_schema: schema.includes("breadcrumblist"),
		geo_answer_first: f.hasAnswerFirst,
		geo_question_headings: f.questionHeadings,
		geo_summary_table: f.hasSummaryTable,
	};
}

export function buildBenchmark(target: PageFeatures, competitors: PageFeatures[]): BenchmarkRow[] {
	return [toBenchmarkRow(target), ...competitors.filter(c => c.ok).map(toBenchmarkRow)];
}

// ---------------------------------------------------------------------------
// Gap sourcing engine (the 3+-evidence gate)
// ---------------------------------------------------------------------------

type GapRule = {
	id: string;
	category: string;
	dimension: GapDimension;
	baseSeverity: Exclude<Severity, "pass">;
	owner: string;
	/** True when the target has the problem. */
	targetMissing: (t: PageFeatures) => boolean;
	/** True when a competitor handles the element correctly (= evidence). */
	competitorHas: (c: PageFeatures) => boolean;
	/** Extract a concrete example value from an evidence page. */
	example: (c: PageFeatures) => string;
	title: (haveCount: number, total: number) => string;
	whyItMatters: string;
	recommendedAction: string;
	/** Absolute hygiene rules flag regardless of SERP prevalence. */
	absolute?: boolean;
};

const GAP_RULES: GapRule[] = [
	// --- Technical / indexability (absolute hygiene) ---
	{
		id: "tech.missing_title",
		category: "technical",
		dimension: "onpage_seo",
		baseSeverity: "high",
		owner: "dev",
		absolute: true,
		targetMissing: t => !t.title.trim(),
		competitorHas: c => !!c.title.trim(),
		example: c => `"${c.title}" (${c.titleLength} chars)`,
		title: () => "Missing <title> tag",
		whyItMatters: "The title is the strongest on-page relevance and click signal for both search and AI systems.",
		recommendedAction:
			"Add a unique, descriptive <title> (≈50–60 chars) that names the page topic and primary keyword.",
	},
	{
		id: "tech.title_too_long",
		category: "technical",
		dimension: "onpage_seo",
		baseSeverity: "low",
		owner: "content",
		absolute: true,
		targetMissing: t => t.titleLength > 65,
		competitorHas: c => c.titleLength > 0 && c.titleLength <= 65,
		example: c => `"${c.title}" (${c.titleLength} chars)`,
		title: () => "Title is too long and will truncate",
		whyItMatters: "Long titles truncate in results, weakening the click signal.",
		recommendedAction: "Trim the title to ≈50–60 characters while keeping the primary keyword early.",
	},
	{
		id: "tech.missing_meta_description",
		category: "technical",
		dimension: "onpage_seo",
		baseSeverity: "medium",
		owner: "content",
		absolute: true,
		targetMissing: t => !t.metaDescription.trim(),
		competitorHas: c => !!c.metaDescription.trim(),
		example: c => `"${c.metaDescription.slice(0, 120)}"`,
		title: () => "Missing meta description",
		whyItMatters: "The meta description shapes the result snippet and click-through.",
		recommendedAction: "Write a 140–160 char meta description that answers the query and includes the keyword.",
	},
	{
		id: "tech.missing_canonical",
		category: "technical",
		dimension: "onpage_seo",
		baseSeverity: "medium",
		owner: "dev",
		absolute: true,
		targetMissing: t => !t.canonical,
		competitorHas: c => !!c.canonical,
		example: c => `canonical → ${c.canonical}`,
		title: () => "No canonical URL declared",
		whyItMatters: "A self-referencing canonical consolidates ranking signals and prevents duplicate dilution.",
		recommendedAction: 'Add a self-referencing <link rel="canonical"> on the page.',
	},
	{
		id: "tech.h1_problem",
		category: "technical",
		dimension: "onpage_seo",
		baseSeverity: "medium",
		owner: "dev",
		absolute: true,
		targetMissing: t => t.h1Count !== 1,
		competitorHas: c => c.h1Count === 1,
		example: c => `Single H1: "${c.h1Text}"`,
		title: () => "H1 problem (missing or multiple H1s)",
		whyItMatters: "Exactly one clear H1 anchors the page topic for search and AI extraction.",
		recommendedAction: "Use exactly one H1 that names the page's topic; demote the rest to H2/H3.",
	},
	{
		id: "tech.missing_og_tags",
		category: "technical",
		dimension: "onpage_seo",
		baseSeverity: "low",
		owner: "dev",
		targetMissing: t => !t.hasOpenGraph,
		competitorHas: c => c.hasOpenGraph,
		example: c => `${c.domain} ships Open Graph title + description`,
		title: (h, t) => `No Open Graph tags — present in ${h}/${t} ranking pages`,
		whyItMatters: "Open Graph tags control how the page renders when shared and reinforce entity signals.",
		recommendedAction: "Add og:title, og:description, og:image, and og:type meta tags.",
	},
	// --- On-page SEO ---
	{
		id: "onpage.no_internal_links",
		category: "on_page",
		dimension: "internal_linking",
		baseSeverity: "medium",
		owner: "content",
		targetMissing: t => t.internalLinks === 0,
		competitorHas: c => c.internalLinks >= 3,
		example: c => `${c.internalLinks} internal body links`,
		title: (h, t) => `No internal links in body — ${h}/${t} ranking pages link internally`,
		whyItMatters: "Internal links pass authority and route both crawlers and users to related funnel pages.",
		recommendedAction: "Add 3–8 contextual internal links to related guides and the matching service page.",
	},
	{
		id: "onpage.images_missing_alt",
		category: "on_page",
		dimension: "onpage_seo",
		baseSeverity: "low",
		owner: "content",
		targetMissing: t => t.imageCount > 0 && t.imagesWithoutAlt > 0,
		competitorHas: c => c.imageCount > 0 && c.imagesWithoutAlt === 0,
		example: c => `${c.imageCount} images, all with alt text`,
		title: (h, t) => `Images missing alt text — ${h}/${t} ranking pages caption all images`,
		whyItMatters: "Alt text is an accessibility and multi-modal signal AI systems read.",
		recommendedAction: "Add descriptive alt text to every informative image.",
	},
	// --- Content quality ---
	{
		id: "content.faq_missing",
		category: "content",
		dimension: "content_quality",
		baseSeverity: "high",
		owner: "content",
		targetMissing: t => !t.hasFaq,
		competitorHas: c => c.hasFaq,
		example: c =>
			c.faqQuestions.length ? `FAQ incl: ${c.faqQuestions.slice(0, 2).join(" / ")}` : "Has an FAQ / Q&A section",
		title: (h, t) => `No FAQ section — present in ${h}/${t} ranking pages`,
		whyItMatters: "FAQ blocks map directly to query fan-out and are heavily reused in AI answers.",
		recommendedAction: "Add a 6–8 item FAQ section answering the real questions competitors cover.",
	},
	{
		id: "content.no_tables",
		category: "content",
		dimension: "content_quality",
		baseSeverity: "medium",
		owner: "content",
		targetMissing: t => t.tableCount === 0,
		competitorHas: c => c.tableCount > 0,
		example: c => `${c.tableCount} data/comparison table(s)`,
		title: (h, t) => `No comparison/data table — ${h}/${t} ranking pages use one`,
		whyItMatters: "Tables give AI systems pre-structured, extractable data for comparisons and specs.",
		recommendedAction: "Add a comparison or specification table covering the key decision criteria.",
	},
	{
		id: "content.low_numeric_specificity",
		category: "content",
		dimension: "content_quality",
		baseSeverity: "medium",
		owner: "content",
		targetMissing: t => t.wordCount > 300 && t.statMatches < 5,
		competitorHas: c => c.statMatches >= 6,
		example: c => `${c.statMatches} concrete numbers/stats`,
		title: (h, t) => `Low numeric specificity — ${h}/${t} ranking pages are data-dense`,
		whyItMatters: "Specific numbers and statistics are one of the few validated tactics that earn AI citations.",
		recommendedAction:
			"Add concrete figures: prices, rates, percentages, counts, dates, and benchmarks with sources.",
	},
	// --- E-E-A-T ---
	{
		id: "eeat.no_named_author",
		category: "eeat",
		dimension: "eeat",
		baseSeverity: "high",
		owner: "content",
		targetMissing: t => !t.hasAuthorSignal,
		competitorHas: c => c.hasAuthorSignal,
		example: c => `${c.domain} shows a named author / reviewer`,
		title: (h, t) => `No named author — ${h}/${t} ranking pages attribute authorship`,
		whyItMatters: "Author and reviewer signals are core E-E-A-T evidence, especially for YMYL topics.",
		recommendedAction: "Add a visible byline + author bio with credentials, plus Person/Article schema.",
	},
	{
		id: "eeat.no_date_signal",
		category: "eeat",
		dimension: "eeat",
		baseSeverity: "medium",
		owner: "content",
		targetMissing: t => !t.hasDateSignal,
		competitorHas: c => c.hasDateSignal,
		example: c => `${c.domain} shows published/updated dates`,
		title: (h, t) => `No date/freshness signal — ${h}/${t} ranking pages show dates`,
		whyItMatters: "Visible published/updated dates signal freshness and maintenance to users and AI.",
		recommendedAction: "Show Published and Updated dates and add datePublished/dateModified schema.",
	},
	// --- Conversion ---
	{
		id: "conv.no_inline_cta",
		category: "conversion",
		dimension: "conversion",
		baseSeverity: "medium",
		owner: "marketing",
		targetMissing: t => !t.conv.hasInlineCta,
		competitorHas: c => c.conv.hasInlineCta,
		example: c =>
			c.conv.ctaTexts.find(x => STRONG_CTA.test(x))
				? `CTA: "${c.conv.ctaTexts.find(x => STRONG_CTA.test(x))}"`
				: "Has an action CTA",
		title: (h, t) => `No action CTA — ${h}/${t} ranking pages convert inline`,
		whyItMatters: "On commercial SERPs, ranking pages capture intent with a clear action CTA.",
		recommendedAction:
			"Add an action-specific CTA (Apply Now, Get a Quote, Check Eligibility) above the fold and inline.",
	},
	{
		id: "conv.no_calculator",
		category: "conversion",
		dimension: "conversion",
		baseSeverity: "medium",
		owner: "product",
		targetMissing: t => !t.conv.hasCalculator,
		competitorHas: c => c.conv.hasCalculator,
		example: c => `${c.domain} embeds a calculator/interactive tool`,
		title: (h, t) => `No embedded tool/calculator — ${h}/${t} ranking pages have one`,
		whyItMatters: "Interactive tools raise engagement and dwell time and are hard for AI summaries to replace.",
		recommendedAction: "Embed a relevant calculator, eligibility checker, or comparison widget.",
	},
	{
		id: "conv.cta_weak",
		category: "conversion",
		dimension: "conversion",
		baseSeverity: "low",
		owner: "marketing",
		targetMissing: t => t.conv.ctaWeak,
		competitorHas: c => c.conv.hasInlineCta,
		example: c => `${c.domain} uses action-specific CTA copy`,
		title: (h, t) => `Weak CTA copy — ${h}/${t} ranking pages use action-specific CTAs`,
		whyItMatters: '"Learn more" loses intent that an action verb would capture.',
		recommendedAction: "Replace generic CTAs with action-specific copy tied to the conversion (Apply, Get Quote).",
	},
	// --- Structured data ---
	{
		id: "schema.none",
		category: "schema",
		dimension: "structured_data",
		baseSeverity: "high",
		owner: "dev",
		targetMissing: t => t.schemaTypes.length === 0,
		competitorHas: c => c.schemaTypes.length > 0,
		example: c => `Schema: ${c.schemaTypes.slice(0, 4).join(", ")}`,
		title: (h, t) => `No JSON-LD schema — ${h}/${t} ranking pages ship structured data`,
		whyItMatters: "Structured data identifies entities, authors, products, and FAQs for AI systems.",
		recommendedAction:
			"Add Organization/WebSite globally plus the page-type schema (Article, Product/Service, FAQPage).",
	},
	{
		id: "schema.faq_content_no_schema",
		category: "schema",
		dimension: "structured_data",
		baseSeverity: "medium",
		owner: "dev",
		targetMissing: t => t.hasFaq && !t.schemaTypes.map(s => s.toLowerCase()).includes("faqpage"),
		competitorHas: c => c.schemaTypes.map(s => s.toLowerCase()).includes("faqpage"),
		example: c => `${c.domain} marks up FAQPage schema`,
		title: (h, t) => `FAQ content without FAQPage schema — ${h}/${t} ranking pages mark it up`,
		whyItMatters: "FAQPage schema makes Q&A eligible for rich results and AI extraction.",
		recommendedAction: "Wrap the visible FAQ in valid FAQPage JSON-LD.",
	},
	// --- GEO / AI extractability ---
	{
		id: "geo.no_answer_first",
		category: "geo",
		dimension: "geo_readiness",
		baseSeverity: "medium",
		owner: "content",
		targetMissing: t => !t.hasAnswerFirst,
		competitorHas: c => c.hasAnswerFirst,
		example: c => `${c.domain} opens with a concise direct answer`,
		title: (h, t) => `No direct answer near the top — ${h}/${t} ranking pages lead with the answer`,
		whyItMatters: "AI systems lift the first concise, self-contained answer; a slow intro gets skipped.",
		recommendedAction: "Open with a 40–80 word direct answer to the primary query (inverse pyramid).",
	},
	{
		id: "geo.no_question_headings",
		category: "geo",
		dimension: "geo_readiness",
		baseSeverity: "medium",
		owner: "content",
		targetMissing: t => t.h2Count + t.h3Count > 0 && t.questionHeadings === 0,
		competitorHas: c => c.questionHeadings > 0,
		example: c => `${c.questionHeadings} question-style heading(s)`,
		title: (h, t) => `No question-led headings — ${h}/${t} ranking pages use them`,
		whyItMatters: "Question headings match query phrasing and create clean, citable answer chunks.",
		recommendedAction: "Rewrite 30–50% of H2/H3s as natural questions and answer each immediately below.",
	},
	{
		id: "geo.low_chunkability",
		category: "geo",
		dimension: "geo_readiness",
		baseSeverity: "low",
		owner: "content",
		targetMissing: t => t.longParagraphs > 0,
		competitorHas: c => c.wordCount > 400 && c.longParagraphs === 0,
		example: c => `${c.domain} keeps paragraphs short and chunkable`,
		title: (h, t) => `Long paragraphs hurt chunkability — ${h}/${t} ranking pages stay chunkable`,
		whyItMatters: "Engines retrieve 500–800 token chunks; very long paragraphs dilute extractable passages.",
		recommendedAction: "Break paragraphs over ~250 words into focused, self-contained passages.",
	},
];

function bumpSeverity(s: Severity, prevalence: number, total: number): Severity {
	// Severity tracks SERP consensus: the more of the ranking set does something
	// the target lacks, the more it is table-stakes rather than nice-to-have.
	const share = total > 0 ? prevalence / total : 0;
	if (share >= 0.8) {
		// Near-universal: this is a baseline requirement to compete.
		if (s === "high") return "critical";
		if (s === "medium") return "high";
		if (s === "low") return "medium";
	} else if (share >= 0.5) {
		// Majority of the SERP: clearly expected.
		if (s === "medium") return "high";
		if (s === "low") return "medium";
	}
	return s;
}

function buildGap(rule: GapRule, evidence: SerpEvidence[], total: number): Gap {
	const haveCount = evidence.length;
	const validated = haveCount >= 3;
	let severity: Severity;
	if (validated) {
		severity = bumpSeverity(rule.baseSeverity, haveCount, total);
	} else if (rule.absolute) {
		severity = rule.baseSeverity;
	} else {
		severity = "low";
	}

	const confidence = validated
		? Math.min(0.97, 0.55 + 0.05 * haveCount)
		: rule.absolute
			? 0.8
			: 0.35 + 0.05 * haveCount;

	const prevalence =
		haveCount > 0
			? `${haveCount}/${total} ranking pages do this`
			: rule.absolute
				? "Baseline best practice (technical hygiene)"
				: "Not observed on ranking pages";

	return {
		id: rule.id,
		category: rule.category,
		dimension: rule.dimension,
		title: rule.title(haveCount, total),
		severity,
		confidence: Math.round(confidence * 100) / 100,
		serp_validated: validated,
		serp_prevalence: prevalence,
		serp_evidence: evidence.slice(0, 5),
		impact: severity === "critical" || severity === "high" ? "high" : severity === "medium" ? "medium" : "low",
		evidence: { rule: rule.id, haveCount, total },
		why_it_matters: rule.whyItMatters,
		recommended_action: rule.recommendedAction,
		suggested_fix: "",
		owner: rule.owner,
		auto_fixable: rule.id.startsWith("tech.") || rule.id.startsWith("schema."),
	};
}

/** Intent-driven findings that depend on the verdict (Rules 2, 4, 5, 6, 7). */
function intentGaps(intent: IntentVerdict, target: PageFeatures, competitors: PageFeatures[]): Gap[] {
	const gaps: Gap[] = [];
	const ok = competitors.filter(c => c.ok);
	const total = ok.length || 1;

	// Rule 2 / 4 — intent mismatch (the most critical finding when present).
	if (intent.mismatch) {
		const wanted =
			intent.verdict === "service_page"
				? ["product_service", "tool", "hybrid", "category"]
				: ["blog_guide", "hybrid", "news"];
		const evidence: SerpEvidence[] = ok
			.filter(c => wanted.includes(c.pageType))
			.slice(0, 5)
			.map(c => ({
				rank: c.rank,
				domain: c.domain,
				example_value: `Ranks as a ${c.pageType.replace("_", "/")} page`,
			}));
		gaps.push({
			id: "intent.mismatch_critical",
			category: "intent",
			dimension: "intent_match",
			title: `Intent mismatch — your ${intent.targetPageType.replace("_", "/")} page does not match the SERP's ${intent.verdict.replace("_", " ")} verdict`,
			severity: "critical",
			confidence: 0.92,
			serp_validated: evidence.length >= 3,
			serp_prevalence: `${evidence.length}/${total} ranking pages use the SERP-favoured format`,
			serp_evidence: evidence,
			impact: "high",
			evidence: {
				verdict: intent.verdict,
				ruleApplied: intent.ruleApplied,
				targetPageType: intent.targetPageType,
				composition: intent.composition.counts,
			},
			why_it_matters:
				intent.ruleApplied === 4
					? "The keyword carries an action modifier and the SERP is dominated by service/product pages — this is strict transactional intent and a blog cannot rank here regardless of quality."
					: "Google is rewarding a different page format for this keyword. On-page quality cannot overcome the wrong page type.",
			recommended_action: intent.verdictLabel,
			suggested_fix: "",
			owner: "strategy",
			auto_fixable: false,
		});
	}

	// Rule 5 — hybrid page conversion requirements.
	if (intent.hybridRequired) {
		const hybridChecks: {
			id: string;
			missing: boolean;
			title: string;
			has: (c: PageFeatures) => boolean;
			example: (c: PageFeatures) => string;
			why: string;
			action: string;
		}[] = [
			{
				id: "intent.hybrid_missing_tool",
				missing: !target.conv.hasCalculator,
				title: "Hybrid intent but no embedded tool/calculator",
				has: c => c.conv.hasCalculator,
				example: c => `${c.domain} embeds a calculator/checker`,
				why: "Mixed-intent SERPs reward hybrid pages that include an interactive tool.",
				action: "Embed a calculator, eligibility checker, comparison widget, or quiz.",
			},
			{
				id: "intent.hybrid_missing_cta",
				missing: !target.conv.hasInlineCta && !target.conv.hasStickyCta,
				title: "Hybrid intent but no inline/sticky conversion CTA",
				has: c => c.conv.hasInlineCta || c.conv.hasStickyCta,
				example: c => `${c.domain} carries an inline/sticky CTA`,
				why: "A competing hybrid page captures commercial intent with a sticky or inline CTA.",
				action: "Add a sticky or inline action CTA (Apply Now, Get Quote, Check Eligibility).",
			},
			{
				id: "intent.hybrid_missing_schema",
				missing: !target.schemaTypes.some(s => /^(product|service|loanorcredit|faqpage|offer)$/i.test(s)),
				title: "Hybrid intent but no commercial/FAQ schema",
				has: c => c.schemaTypes.some(s => /^(product|service|loanorcredit|faqpage|offer)$/i.test(s)),
				example: c => `${c.domain}: ${c.schemaTypes.slice(0, 4).join(", ")}`,
				why: "Product/Service/LoanOrCredit/FAQPage schema is treated as required for competitive hybrid pages.",
				action: "Add Product, Service, LoanOrCredit, or FAQPage JSON-LD as relevant.",
			},
		];
		for (const hc of hybridChecks) {
			if (!hc.missing) continue;
			const evidence = ok
				.filter(hc.has)
				.slice(0, 5)
				.map(c => ({ rank: c.rank, domain: c.domain, example_value: hc.example(c) }));
			gaps.push({
				id: hc.id,
				category: "intent",
				dimension: "conversion",
				title: `${hc.title}${evidence.length ? ` — ${evidence.length}/${total} ranking pages include it` : ""}`,
				severity: evidence.length >= 3 ? "high" : "medium",
				confidence: evidence.length >= 3 ? 0.85 : 0.5,
				serp_validated: evidence.length >= 3,
				serp_prevalence: `${evidence.length}/${total} ranking pages include this`,
				serp_evidence: evidence,
				impact: "high",
				evidence: { rule: hc.id },
				why_it_matters: hc.why,
				recommended_action: hc.action,
				suggested_fix: "",
				owner: "product",
				auto_fixable: false,
			});
		}
	}

	// Rule 6 / 7 — internal link to the service/application page from a blog/hybrid.
	if (
		(target.pageType === "blog_guide" || target.pageType === "hybrid") &&
		(intent.verdict !== "informational" || intent.hybridRequired) &&
		!target.hasServiceInternalLink
	) {
		const evidence = ok
			.filter(c => c.hasServiceInternalLink)
			.slice(0, 5)
			.map(c => ({
				rank: c.rank,
				domain: c.domain,
				example_value: `${c.domain} links to its service/application page`,
			}));
		gaps.push({
			id: "intent.missing_internal_link_to_service",
			category: "intent",
			dimension: "internal_linking",
			title: `No internal link to a service/application page${evidence.length ? ` — ${evidence.length}/${total} ranking pages bridge to one` : ""}`,
			severity: evidence.length >= 3 ? "high" : "medium",
			confidence: evidence.length >= 3 ? 0.8 : 0.45,
			serp_validated: evidence.length >= 3,
			serp_prevalence: `${evidence.length}/${total} ranking pages link to a service/product page`,
			serp_evidence: evidence,
			impact: "high",
			evidence: { rule: "intent.missing_internal_link_to_service" },
			why_it_matters:
				"Intent is not passed down the funnel: a blog on a commercial keyword should link to the brand's own service/application page (cluster → pillar).",
			recommended_action:
				"Add a contextual internal link from this page to the matching service/product/application page.",
			suggested_fix: "",
			owner: "content",
			auto_fixable: false,
		});
	}

	return gaps;
}

function median(nums: number[]): number {
	const s = nums.filter(n => n >= 0).sort((a, b) => a - b);
	if (!s.length) return 0;
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Benchmark-relative gaps. The old engine only flagged binary absences (no FAQ,
 * no table). That let a thin page that *technically* has every element score
 * high. These gaps fire when the target is materially WORSE than the ranking
 * median on a measurable axis — the most common real reason a page underranks.
 * They are inherently SERP-validated (the evidence is the pages above the bar).
 */
function benchmarkGaps(target: PageFeatures, competitors: PageFeatures[]): Gap[] {
	const ok = competitors.filter(c => c.ok);
	const total = ok.length;
	if (total < 3) return []; // not enough data for a trustworthy median
	const gaps: Gap[] = [];

	const mk = (
		id: string,
		dimension: GapDimension,
		baseSeverity: Exclude<Severity, "pass">,
		title: string,
		why: string,
		action: string,
		evidence: SerpEvidence[],
		owner = "content",
	): Gap => {
		const validated = evidence.length >= 3;
		const severity = validated ? baseSeverity : baseSeverity === "high" ? "medium" : "low";
		return {
			id,
			category: "benchmark",
			dimension,
			title,
			severity,
			confidence: validated ? Math.min(0.95, 0.6 + 0.05 * evidence.length) : 0.45,
			serp_validated: validated,
			serp_prevalence: `${evidence.length}/${total} ranking pages clear this bar`,
			serp_evidence: evidence.slice(0, 5),
			impact: severity === "high" ? "high" : severity === "medium" ? "medium" : "low",
			evidence: { rule: id },
			why_it_matters: why,
			recommended_action: action,
			suggested_fix: "",
			owner,
			auto_fixable: false,
		};
	};

	// 1. Content depth vs median word count.
	const wcMedian = median(ok.map(c => c.wordCount));
	if (wcMedian >= 400 && target.wordCount < wcMedian * 0.6) {
		const ev = ok
			.filter(c => c.wordCount >= wcMedian)
			.sort((a, b) => b.wordCount - a.wordCount)
			.slice(0, 5)
			.map(c => ({ rank: c.rank, domain: c.domain, example_value: `${c.wordCount} words` }));
		gaps.push(
			mk(
				"bench.thin_vs_serp",
				"content_quality",
				target.wordCount < wcMedian * 0.35 ? "critical" : "high",
				`Content is thin vs the SERP — ${target.wordCount}w against a ${wcMedian}w ranking median`,
				"Coverage depth strongly correlates with ranking and citation here; a page well under the median rarely answers the full query fan-out.",
				`Expand to roughly the ${wcMedian}-word ranking median by covering the sub-topics, comparisons, and questions the leaders cover.`,
				ev,
			),
		);
	}

	// 2. Section structure vs median H2 count.
	const h2Median = median(ok.map(c => c.h2Count));
	if (h2Median >= 4 && target.h2Count < h2Median - 2) {
		const ev = ok
			.filter(c => c.h2Count >= h2Median)
			.slice(0, 5)
			.map(c => ({ rank: c.rank, domain: c.domain, example_value: `${c.h2Count} H2 sections` }));
		gaps.push(
			mk(
				"bench.shallow_structure",
				"content_quality",
				"medium",
				`Shallow section structure — ${target.h2Count} H2s vs a ${h2Median}-section ranking median`,
				"Ranking pages segment the topic into many extractable sections; a flat page gives engines fewer self-contained passages to cite.",
				`Break the content into ~${h2Median} clearly-titled H2 sections, ideally phrased as the questions searchers ask.`,
				ev,
			),
		);
	}

	// 3. Numeric specificity vs median stat density.
	const statMedian = median(ok.map(c => c.statMatches));
	if (statMedian >= 6 && target.statMatches < statMedian * 0.5) {
		const ev = ok
			.filter(c => c.statMatches >= statMedian)
			.slice(0, 5)
			.map(c => ({ rank: c.rank, domain: c.domain, example_value: `${c.statMatches} concrete numbers` }));
		gaps.push(
			mk(
				"bench.low_data_density",
				"content_quality",
				"medium",
				`Low data density — ${target.statMatches} numbers vs a ${statMedian} ranking median`,
				"Concrete figures (rates, prices, percentages, counts) are among the few validated drivers of AI citation; data-sparse pages get skipped.",
				"Add specific, sourced figures throughout — prices, rates, timelines, sample sizes, and benchmarks.",
				ev,
			),
		);
	}

	// 4. Schema breadth vs median.
	const schemaMedian = median(ok.map(c => c.schemaTypes.length));
	if (schemaMedian >= 2 && target.schemaTypes.length < schemaMedian) {
		const ev = ok
			.filter(c => c.schemaTypes.length >= schemaMedian)
			.slice(0, 5)
			.map(c => ({
				rank: c.rank,
				domain: c.domain,
				example_value: c.schemaTypes.slice(0, 4).join(", ") || "rich schema",
			}));
		gaps.push(
			mk(
				"bench.shallow_schema",
				"structured_data",
				"medium",
				`Fewer schema types than the SERP — ${target.schemaTypes.length} vs a ${schemaMedian} ranking median`,
				"Ranking pages stack multiple schema types (entity, breadcrumb, FAQ, product/article) to be fully machine-readable.",
				"Add the page-type schema plus Organization, BreadcrumbList, and FAQPage as relevant.",
				ev,
				"dev",
			),
		);
	}

	// 5. Internal linking vs median.
	const linkMedian = median(ok.map(c => c.internalLinks));
	if (linkMedian >= 5 && target.internalLinks < Math.max(2, linkMedian * 0.4)) {
		const ev = ok
			.filter(c => c.internalLinks >= linkMedian)
			.slice(0, 5)
			.map(c => ({ rank: c.rank, domain: c.domain, example_value: `${c.internalLinks} internal links` }));
		gaps.push(
			mk(
				"bench.weak_internal_linking",
				"internal_linking",
				"medium",
				`Sparse internal linking — ${target.internalLinks} vs a ${linkMedian} ranking median`,
				"Internal links distribute authority and route crawlers/users to the rest of the topic cluster and funnel.",
				`Add contextual internal links toward the ~${linkMedian} the ranking pages use, including the matching service/pillar page.`,
				ev,
			),
		);
	}

	return gaps;
}

export type GapResult = {
	serpValidated: Gap[];
	lowConfidence: Gap[];
	all: Gap[];
};

export function sourceGaps(target: PageFeatures, competitors: PageFeatures[], intent: IntentVerdict): GapResult {
	const ok = competitors.filter(c => c.ok);
	const total = ok.length || 1;
	const all: Gap[] = [];

	// Intent gaps first (mismatch must surface before everything else).
	all.push(...intentGaps(intent, target, competitors));

	// Benchmark-relative gaps (target materially below the ranking median).
	all.push(...benchmarkGaps(target, competitors));

	for (const rule of GAP_RULES) {
		if (!rule.targetMissing(target)) continue;
		const evidence: SerpEvidence[] = ok
			.filter(c => rule.competitorHas(c))
			.slice(0, 5)
			.map(c => ({ rank: c.rank, domain: c.domain, example_value: rule.example(c) }));
		// Skip non-absolute rules with zero supporting evidence (no SERP proof).
		if (!rule.absolute && evidence.length === 0) continue;
		all.push(buildGap(rule, evidence, total));
	}

	const order: Severity[] = ["critical", "high", "medium", "low", "pass"];
	all.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

	return {
		all,
		serpValidated: all.filter(g => g.serp_validated),
		lowConfidence: all.filter(g => !g.serp_validated),
	};
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// Dimension weights reflect the ACTUAL significance of each axis to SEO ranking
// AND GEO (AI citation), 2024–26:
//   - Discovery/citation core (72%): intent is the master gate; content depth is
//     the workhorse for both; GEO extractability is the AI-citation differentiator;
//     E-E-A-T/authority gates trust (and YMYL). These decide whether you rank or
//     get cited at all.
//   - Technical/structural (25%): on-page hygiene + schema (machine-readability,
//     more important for GEO than classic ranking) + internal linking (support).
//   - Conversion (3%): a business OUTCOME, not a discovery/ranking/citation signal
//     — kept only as a light transactional-fit nudge so it can no longer inflate
//     the score by being trivially maxed out.
export const DIMENSION_WEIGHTS: Record<GapDimension, number> = {
	intent_match: 22,
	content_quality: 20,
	geo_readiness: 15,
	eeat: 15,
	onpage_seo: 10,
	structured_data: 10,
	internal_linking: 5,
	conversion: 3,
};

/**
 * Best-practice scoring model.
 *
 * The old model started every dimension at 100 and only subtracted for detected
 * gaps — so a page with no *detected* gap in a dimension scored a perfect 100,
 * which made composites far too lenient (absence of a flagged gap ≠ excellence).
 *
 * This model is POINTS-EARNED: each dimension is a set of weighted criteria the
 * page must positively satisfy (many graded against the live SERP median, not an
 * absolute), and the subscore is earned ÷ possible. A page now has to actually
 * demonstrate the SEO/GEO signals the ranking set has to score high. Intent is
 * special: a hard format mismatch caps the whole composite (intent overrides
 * everything in both classic SEO and GEO).
 */
export function scorePageGap(
	target: PageFeatures,
	competitors: PageFeatures[],
	intent: IntentVerdict,
): { subScores: SubScores; composite: number } {
	const ok = competitors.filter(c => c.ok);
	const t = target;
	const med = {
		words: median(ok.map(c => c.wordCount)),
		h2: median(ok.map(c => c.h2Count)),
		stats: median(ok.map(c => c.statMatches)),
		internal: median(ok.map(c => c.internalLinks)),
		schema: median(ok.map(c => c.schemaTypes.length)),
		qHead: median(ok.map(c => c.questionHeadings)),
	};

	// got = fraction of a criterion satisfied (0–1). subscore = Σ(pts·got)/Σpts.
	const dim = (crits: [pts: number, got: number][]): number => {
		const possible = crits.reduce((s, [p]) => s + p, 0);
		if (!possible) return 50;
		const earned = crits.reduce((s, [p, g]) => s + p * Math.max(0, Math.min(1, g)), 0);
		return Math.round((earned / possible) * 100);
	};
	const b = (cond: boolean) => (cond ? 1 : 0);
	// Ratio vs a target value, capped at 1. Below ~40% of target earns ~0.
	const ratio = (v: number, target: number) => (target > 0 ? Math.max(0, Math.min(1, v / target)) : v > 0 ? 1 : 0.5);

	const schemaLc = t.schemaTypes.map(s => s.toLowerCase());
	const subScores = {} as SubScores;

	// --- On-page SEO (technical hygiene + core relevance signals) -------------
	subScores.onpage_seo = dim([
		[3, !t.title.trim() ? 0 : t.titleLength >= 30 && t.titleLength <= 65 ? 1 : 0.6],
		[2, !t.metaDescription.trim() ? 0 : t.metaDescription.length >= 70 && t.metaDescription.length <= 165 ? 1 : 0.6],
		[3, t.h1Count === 1 ? 1 : t.h1Count === 0 ? 0 : 0.4],
		[1.5, b(!!t.canonical)],
		[1, b(t.hasOpenGraph)],
		[1.5, t.imageCount === 0 ? 1 : 1 - t.imagesWithoutAlt / Math.max(1, t.imageCount)],
		[1, b(t.hasViewport)],
	]);

	// --- Content quality (depth & coverage vs the ranking set) ----------------
	subScores.content_quality = dim([
		[4, ratio(t.wordCount, med.words || 800)],
		[2, ratio(t.h2Count, med.h2 || 4)],
		[1.5, b(t.tableCount > 0)],
		[2.5, b(t.hasFaq)],
		[2, ratio(t.statMatches, med.stats || 6)],
		[1, b(t.listCount > 0)],
	]);

	// --- E-E-A-T / trust ------------------------------------------------------
	subScores.eeat = dim([
		[3, b(t.hasAuthorSignal)],
		[2, b(t.hasDateSignal)],
		[1, b(t.hasUpdatedYear)],
		[1.5, ratio(t.qualityExternalLinks, 2)],
	]);

	// --- Conversion (intent-aware: informational pages aren't penalised) ------
	let conversion = dim([
		[3, t.conv.hasInlineCta ? 1 : t.conv.ctaWeak ? 0.3 : 0],
		[2, b(t.conv.hasCalculator)],
		[1, b(t.conv.hasStickyCta)],
		[1, b(t.conv.priceSignals > 0)],
	]);
	if (intent.verdict === "informational" && !intent.hybridRequired) {
		conversion = Math.max(conversion, 75); // a pure guide legitimately may not convert
	}
	subScores.conversion = conversion;

	// --- Internal linking -----------------------------------------------------
	const svcRelevant = intent.verdict !== "informational" || intent.hybridRequired;
	subScores.internal_linking = dim([
		[3, ratio(t.internalLinks, Math.max(5, med.internal || 5))],
		[2, svcRelevant ? b(t.hasServiceInternalLink) : 1],
	]);

	// --- Structured data ------------------------------------------------------
	const wantCommercial = ["product_service", "tool", "category"].includes(t.pageType);
	const wantArticle = ["blog_guide", "news", "comparison"].includes(t.pageType);
	const typeSchemaGot = wantCommercial
		? b(schemaLc.some(s => COMMERCIAL_SCHEMA.test(s)))
		: wantArticle
			? b(schemaLc.some(s => ARTICLE_SCHEMA.test(s)))
			: b(t.schemaTypes.length > 0);
	subScores.structured_data = dim([
		[2, b(t.schemaTypes.length > 0)],
		[2, ratio(t.schemaTypes.length, Math.max(2, med.schema || 2))],
		[1.5, t.hasFaq ? b(schemaLc.includes("faqpage")) : 1],
		[1.5, typeSchemaGot],
	]);

	// --- GEO readiness (AI extractability / citability) -----------------------
	subScores.geo_readiness = dim([
		[3, b(t.hasAnswerFirst)],
		[2, ratio(t.questionHeadings, Math.max(2, med.qHead || 2))],
		[1.5, t.longParagraphs === 0 ? 1 : Math.max(0, 1 - t.longParagraphs * 0.25)],
		[1, b(t.hasUpdatedYear || t.hasDateSignal)],
		[1.5, ratio(t.statMatches, 3)],
	]);

	// --- Intent match (special — also a global multiplier below) --------------
	if (intent.mismatch) {
		subScores.intent_match = 8;
	} else if (intent.hybridRequired) {
		const missing =
			(!t.conv.hasCalculator ? 1 : 0) +
			(!t.conv.hasInlineCta && !t.conv.hasStickyCta ? 1 : 0) +
			(!t.schemaTypes.some(s => /^(product|service|loanorcredit|faqpage|offer)$/i.test(s)) ? 1 : 0);
		subScores.intent_match = Math.max(22, 75 - missing * 20);
	} else {
		const verdictMatch =
			intent.verdict === "service_page"
				? ["product_service", "tool", "category", "hybrid"].includes(t.pageType)
				: ["blog_guide", "news", "comparison", "hybrid"].includes(t.pageType);
		const conf = t.pageTypeScore?.confidence ?? 50;
		let base = verdictMatch ? 88 : 62;
		if (t.pageType === "unknown") base = 50;
		subScores.intent_match = Math.round(base * (0.65 + 0.35 * (conf / 100)));
	}

	let composite = Math.round(
		(Object.entries(DIMENSION_WEIGHTS) as [GapDimension, number][]).reduce(
			(sum, [d, weight]) => sum + subScores[d] * (weight / 100),
			0,
		),
	);

	// Intent overrides everything: a hard format mismatch caps the composite, no
	// matter how strong the page is on every other axis.
	if (intent.mismatch) composite = Math.min(composite, 32);

	return { subScores, composite };
}
