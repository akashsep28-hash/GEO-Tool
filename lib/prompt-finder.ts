/**
 * GEO Prompt Finder — deterministic engine (no LLM).
 *
 * Given a finished Page Gap run (URL + keyword + country + device already drove
 * the SERP audit), this deduces the page's industry / niche / topic / intent
 * and builds the real-world natural-language PROMPTS a buyer or researcher would
 * type into ChatGPT / Perplexity / Gemini / Google AI Overviews that this page
 * should be cited in — then maps each prompt to the concrete GEO items the page
 * must update to actually win it.
 *
 * It runs purely on the engine signals already captured (page type, intent
 * verdict, headings, schema, conversion, SERP composition, competitors). The
 * LLM layer (lib/page-gap-llm.ts) can refine/expand this for higher accuracy,
 * but this baseline always produces a usable result with zero API keys.
 *
 * Inspired by the open-source geo-aeo-tracker "Niche Explorer" prompt-bank
 * pattern (high-intent, conversational, source-seeking, mixed-intent-stage),
 * adapted to be page-specific and tied to actionable GEO fixes.
 */

import type { PageFeatures } from "@/lib/page-gap-engine";
import type { PageGapResult } from "@/lib/page-gap-run";

export type PromptIntent = "informational" | "commercial" | "comparison" | "transactional" | "local";

export type PromptReadiness = "ready" | "partial" | "missing";

export type GeoPrompt = {
	prompt: string;
	intent: PromptIntent;
	platforms: string[];
	rationale: string;
	readiness: PromptReadiness;
	/** GEO items this page must add/fix to be cited for this prompt. */
	alignmentActions: string[];
};

export type GeoOptimizationItem = {
	item: string;
	why: string;
	/** Which prompts this single fix helps the page win. */
	prompts: string[];
	priority: "critical" | "high" | "medium" | "low";
};

export type PromptFinderResult = {
	industry: string;
	niche: string;
	topic: string;
	audience: string;
	primaryIntent: string;
	relevanceNotes: string;
	industryConfidence: number;
	isYmyl: boolean;
	prompts: GeoPrompt[];
	geoOptimizationItems: GeoOptimizationItem[];
	source: "deterministic" | "ai";
	model?: string;
	generatedAt: string;
};

// ---------------------------------------------------------------------------
// Industry / niche detection (multi-signal, like the page-type classifier).
// ---------------------------------------------------------------------------

type IndustryDef = {
	label: string;
	ymyl: boolean;
	re: RegExp;
	schema?: RegExp;
};

const INDUSTRIES: IndustryDef[] = [
	{
		label: "Lending & credit (finance)",
		ymyl: true,
		re: /\b(loan|loans|mortgage|credit card|credit score|borrow|lending|emi|apr|interest rate|refinanc|line of credit|bnpl|overdraft)\b/i,
		schema: /loanorcredit|financialproduct/i,
	},
	{
		label: "Banking & payments (finance)",
		ymyl: true,
		re: /\b(bank|banking|savings account|checking account|debit card|wire transfer|payment|upi|wallet|neobank)\b/i,
		schema: /bankaccount|financialproduct/i,
	},
	{
		label: "Investing & wealth (finance)",
		ymyl: true,
		re: /\b(invest|investing|stocks?|etf|mutual fund|portfolio|crypto|bitcoin|trading|retirement|401k|ira|pension|wealth)\b/i,
		schema: /investment/i,
	},
	{
		label: "Insurance (finance)",
		ymyl: true,
		re: /\b(insurance|insurer|premium|policyholder|coverage|deductible|life insurance|health insurance|car insurance|claim)\b/i,
	},
	{
		label: "Health & medical",
		ymyl: true,
		re: /\b(health|medical|symptom|disease|treatment|doctor|clinic|therapy|medication|drug|diagnosis|wellness|supplement|nutrition|mental health)\b/i,
		schema: /medicalwebpage|drug|medicalcondition/i,
	},
	{
		label: "Legal services",
		ymyl: true,
		re: /\b(lawyer|attorney|legal|law firm|lawsuit|litigation|divorce|injury claim|compliance|contract|patent|trademark)\b/i,
	},
	{
		label: "Real estate & property",
		ymyl: true,
		re: /\b(real estate|property|home for sale|rent|mortgage|realtor|apartment|housing|landlord|tenant|listing)\b/i,
		schema: /realestatelisting|apartment/i,
	},
	{
		label: "SaaS & software",
		ymyl: false,
		re: /\b(software|saas|platform|app|api|dashboard|crm|automation|integration|tool|plugin|no-code|workflow)\b/i,
		schema: /softwareapplication/i,
	},
	{
		label: "E-commerce & retail",
		ymyl: false,
		re: /\b(buy|shop|store|product|price|discount|deal|shipping|cart|checkout|review|best .* for)\b/i,
		schema: /product|offer|aggregateoffer/i,
	},
	{
		label: "Marketing & SEO",
		ymyl: false,
		re: /\b(seo|geo|marketing|advertis|content strategy|backlink|keyword|ppc|social media|brand|conversion|funnel)\b/i,
	},
	{
		label: "Travel & hospitality",
		ymyl: false,
		re: /\b(travel|hotel|flight|vacation|trip|tour|booking|destination|resort|airbnb|itinerary)\b/i,
	},
	{
		label: "Education & courses",
		ymyl: false,
		re: /\b(course|learn|tutorial|certification|degree|university|training|bootcamp|exam|study|student)\b/i,
		schema: /course/i,
	},
	{
		label: "Automotive",
		ymyl: false,
		re: /\b(car|vehicle|automotive|engine|ev|electric vehicle|truck|suv|dealership|lease|mileage)\b/i,
		schema: /vehicle|car/i,
	},
	{
		label: "Home & local services",
		ymyl: false,
		re: /\b(plumber|electrician|hvac|roofing|cleaning|landscaping|contractor|repair|installation|near me)\b/i,
		schema: /localbusiness|service/i,
	},
	{
		label: "Food & recipes",
		ymyl: false,
		re: /\b(recipe|cook|food|restaurant|meal|diet|ingredient|cuisine|baking)\b/i,
		schema: /recipe/i,
	},
	{
		label: "Fitness & sports",
		ymyl: false,
		re: /\b(workout|fitness|gym|exercise|training|muscle|weight loss|yoga|running|sport)\b/i,
	},
];

function detectIndustry(
	haystack: string,
	schemaTypes: string[],
): {
	label: string;
	ymyl: boolean;
	confidence: number;
} {
	const schemaStr = schemaTypes.join(" ");
	let best: IndustryDef | null = null;
	let bestScore = 0;
	for (const ind of INDUSTRIES) {
		const matches = haystack.match(new RegExp(ind.re, "gi"));
		let score = matches ? matches.length : 0;
		if (ind.schema?.test(schemaStr)) score += 4;
		if (score > bestScore) {
			bestScore = score;
			best = ind;
		}
	}
	if (!best) return { label: "General / informational", ymyl: false, confidence: 25 };
	const confidence = Math.min(95, 45 + bestScore * 10);
	return { label: best.label, ymyl: best.ymyl, confidence };
}

// ---------------------------------------------------------------------------
// Prompt bank construction
// ---------------------------------------------------------------------------

const PLATFORMS: Record<PromptIntent, string[]> = {
	informational: ["ChatGPT", "Perplexity", "Google AI Overviews"],
	comparison: ["Perplexity", "Google AI Overviews", "ChatGPT"],
	commercial: ["Perplexity", "ChatGPT", "Google AI Overviews"],
	transactional: ["Google AI Overviews", "Gemini"],
	local: ["Google AI Overviews", "Gemini"],
};

function titleCase(s: string): string {
	return s.replace(/\b\w/g, c => c.toUpperCase());
}

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Build the prompt bank. We emphasise the intent stage the SERP rewards (from
 * the verdict) but always include adjacent stages — the page may want to expand
 * into a sub-intent no competitor owns well (a GEO opportunity).
 */
function buildPrompts(
	keyword: string,
	t: PageFeatures,
	verdict: PageGapResult["intent"]["verdict"],
	country: string,
	isYmyl: boolean,
	hasLocalSignal: boolean,
): GeoPrompt[] {
	const kw = keyword.trim().toLowerCase();
	const out: GeoPrompt[] = [];

	// What the page can already satisfy (drives readiness).
	const canAnswerFirst = t.hasAnswerFirst;
	const hasQ = t.questionHeadings > 0;
	const hasTable = t.tableCount > 0;
	const hasFaq = t.hasFaq;
	const hasFaqSchema = t.schemaTypes.map(s => s.toLowerCase()).includes("faqpage");
	const hasCta = t.conv.hasInlineCta || t.conv.hasStickyCta;
	const hasData = t.statMatches >= 5;
	const hasAuthor = t.hasAuthorSignal;

	const add = (prompt: string, intent: PromptIntent, rationale: string, needs: { ok: boolean; action: string }[]) => {
		const alignmentActions = needs.filter(n => !n.ok).map(n => n.action);
		const readiness: PromptReadiness =
			alignmentActions.length === 0 ? "ready" : alignmentActions.length === 1 ? "partial" : "missing";
		out.push({ prompt, intent, platforms: PLATFORMS[intent], rationale, readiness, alignmentActions });
	};

	const eeatNeed = {
		ok: !isYmyl || hasAuthor,
		action: "Add a named, credentialed author + reviewer with Person/Author schema (YMYL E-E-A-T)",
	};
	const answerFirstNeed = {
		ok: canAnswerFirst,
		action: "Open with a 40–80 word direct answer to the question (inverse pyramid) for AI extraction",
	};
	const qHeadingNeed = {
		ok: hasQ,
		action: "Phrase the matching H2/H3 as the exact question so it forms a clean citable chunk",
	};
	const faqNeed = {
		ok: hasFaq && hasFaqSchema,
		action: hasFaq
			? "Wrap the existing FAQ in valid FAQPage JSON-LD"
			: "Add a 6–8 item FAQ answering the real sub-questions, marked up with FAQPage schema",
	};
	const tableNeed = {
		ok: hasTable,
		action: "Add a comparison/criteria table the engine can lift as a structured answer",
	};
	const dataNeed = {
		ok: hasData,
		action: "Add concrete, sourced figures (rates, prices, %, counts) — data is a top AI-citation driver",
	};
	const ctaNeed = {
		ok: hasCta,
		action: "Add an action CTA + the transactional detail (eligibility, steps, pricing) the query implies",
	};

	// --- Informational ---
	add(`what is ${kw}`, "informational", "Definitional query AI answer engines lift a one-paragraph answer for.", [
		answerFirstNeed,
		qHeadingNeed,
		eeatNeed,
	]);
	add(`how does ${kw} work`, "informational", "Explainer query — rewards a clear step/section structure.", [
		answerFirstNeed,
		qHeadingNeed,
	]);
	add(
		`${kw} explained with sources`,
		"informational",
		"Source-seeking phrasing favours pages with cited, verifiable data.",
		[dataNeed, eeatNeed],
	);
	add(`is ${kw} worth it`, "informational", "Evaluative query — wants pros/cons and an honest verdict.", [
		answerFirstNeed,
		dataNeed,
	]);

	// --- Comparison ---
	add(
		`best ${kw} ${CURRENT_YEAR}`,
		"comparison",
		"Recommendation query — AI assembles a shortlist from comparison-structured pages.",
		[tableNeed, dataNeed, qHeadingNeed],
	);
	add(`${kw} vs alternatives`, "comparison", "Head-to-head query — needs an explicit comparison table/criteria.", [
		tableNeed,
		faqNeed,
	]);
	add(
		`top ${kw} options for ${isYmyl ? "different needs" : "beginners"}`,
		"comparison",
		"Listicle-style query AI summarises into ranked options.",
		[tableNeed, qHeadingNeed],
	);

	// --- Commercial / transactional (emphasised when the SERP is commercial) ---
	const commercialEmphasis = verdict === "service_page" || verdict === "hybrid_required";
	add(
		`how to ${/loan|credit|mortgage|account|insurance|apply/i.test(kw) ? "apply for" : "get"} ${kw}`,
		"transactional",
		"Action query — wants concrete steps, eligibility and a path to convert.",
		[ctaNeed, answerFirstNeed],
	);
	add(
		`${kw} requirements and eligibility`,
		commercialEmphasis ? "transactional" : "commercial",
		"Qualification query — needs the specific criteria laid out clearly.",
		[dataNeed, faqNeed],
	);
	add(
		`${kw} cost / rates`,
		commercialEmphasis ? "transactional" : "commercial",
		"Price query — AI surfaces pages with explicit, current figures.",
		[dataNeed, tableNeed],
	);

	// --- Local (only when there is a local signal / non-global country) ---
	if (hasLocalSignal) {
		const place = country && country.toLowerCase() !== "us" ? country.toUpperCase() : "your area";
		add(`${kw} near me`, "local", "Local-intent query — needs location signals, NAP, and LocalBusiness schema.", [
			{ ok: false, action: "Add location/NAP details + LocalBusiness schema and localized content" },
		]);
		add(`best ${kw} in ${place}`, "local", "Geo-qualified recommendation query.", [
			tableNeed,
			{ ok: false, action: `Add ${place}-specific content, availability and local proof` },
		]);
	}

	// De-dupe by prompt text.
	const seen = new Set<string>();
	return out.filter(p => {
		const k = p.prompt.toLowerCase();
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

function buildGeoItems(prompts: GeoPrompt[], t: PageFeatures, _isYmyl: boolean): GeoOptimizationItem[] {
	// Aggregate every distinct alignment action across prompts → which prompts it unlocks.
	const byAction = new Map<string, Set<string>>();
	for (const p of prompts) {
		for (const a of p.alignmentActions) {
			if (!byAction.has(a)) byAction.set(a, new Set());
			byAction.get(a)!.add(p.prompt);
		}
	}
	const priorityFor = (action: string): GeoOptimizationItem["priority"] => {
		if (/answer|FAQPage|E-E-A-T|YMYL/i.test(action)) return "high";
		if (/table|figures|data|CTA|eligibility/i.test(action)) return "medium";
		return "low";
	};
	const items: GeoOptimizationItem[] = [...byAction.entries()].map(([item, set]) => ({
		item,
		why: "Required for the AI prompts below to retrieve and cite this page.",
		prompts: [...set],
		priority: priorityFor(item),
	}));

	// Always-on GEO hygiene items even if every prompt happened to be "ready".
	const ensure = (cond: boolean, item: string, why: string, priority: GeoOptimizationItem["priority"]) => {
		if (cond && !items.some(x => x.item === item)) {
			items.push({ item, why, prompts: [], priority });
		}
	};
	ensure(
		t.longParagraphs > 0,
		"Break long paragraphs into <120-word, self-contained passages",
		"AI engines retrieve short chunks; long blocks dilute citability.",
		"medium",
	);
	ensure(
		!t.hasUpdatedYear,
		`Add a visible "updated ${CURRENT_YEAR}" freshness signal + dateModified schema`,
		"Answer engines favour demonstrably fresh content.",
		"low",
	);
	ensure(
		t.schemaTypes.length === 0,
		"Add JSON-LD schema (entity + page-type) so engines can identify the page",
		"Structured data is how AI systems disambiguate entities and content.",
		"high",
	);

	const order = { critical: 0, high: 1, medium: 2, low: 3 };
	return items.sort((a, b) => order[a.priority] - order[b.priority]);
}

export function buildPromptFinder(report: PageGapResult): PromptFinderResult {
	const t = report.target.features;
	const keyword = report.keyword;
	let path = "";
	try {
		path = new URL(report.target.finalUrl || report.targetUrl).pathname;
	} catch {
		/* ignore */
	}
	const haystack = [
		keyword,
		report.target.title,
		report.target.headings?.h1?.join(" ") ?? "",
		report.target.headings?.h2?.join(" ") ?? "",
		path,
	].join(" ");

	const ind = detectIndustry(haystack, t.schemaTypes);
	const hasLocalSignal =
		/\bnear me\b|\bin\s+[a-z]{3,}/i.test(keyword) ||
		report.serp.features?.localPack === true ||
		ind.label.includes("local");

	const prompts = buildPrompts(keyword, t, report.intent.verdict, report.country, ind.ymyl, hasLocalSignal);
	const geoOptimizationItems = buildGeoItems(prompts, t, ind.ymyl);

	const primaryIntent =
		report.intent.verdict === "service_page"
			? "Transactional / commercial"
			: report.intent.verdict === "informational"
				? "Informational"
				: "Hybrid (informational + commercial)";

	const readyCount = prompts.filter(p => p.readiness === "ready").length;
	const relevanceNotes =
		`Page type "${t.pageType.replace("_", "/")}" vs the SERP's ${report.intent.verdict.replace("_", " ")} verdict` +
		(report.intent.mismatch ? " — MISMATCH (fix format before chasing prompts)." : ".") +
		` Currently ready for ${readyCount}/${prompts.length} target prompts; gap score ${report.score}/100.`;

	return {
		industry: ind.label,
		niche: titleCase(keyword),
		topic: cap(keyword),
		audience: `${primaryIntent} searchers researching ${keyword}`,
		primaryIntent,
		relevanceNotes,
		industryConfidence: ind.confidence,
		isYmyl: ind.ymyl,
		prompts,
		geoOptimizationItems,
		source: "deterministic",
		generatedAt: new Date().toISOString(),
	};
}
