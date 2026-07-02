/**
 * Page Gap Analyzer — Schema Registry (the "schema database").
 *
 * Single source of truth for EVERY Schema.org type the generator can emit and
 * the STANDARD for writing each one. The generator does not hard-code property
 * lists any more — it reads them from here. The registry answers three
 * questions for each type:
 *
 *   1. WHEN does a page deserve this type?      → `appliesTo` / `primaryFor`
 *   2. WHAT properties does the standard want?  → `properties` (+ requirement)
 *   3. WHERE does each value legitimately come from? → `source` + `pageGated`
 *
 * The anti-fabrication contract (see [[page-gap-schema]]): a property whose
 * value is not present on the page must NEVER be invented. Such properties are
 * marked `pageGated: true`. When the value can't be sourced from the page, the
 * field is dropped and the type is surfaced as a CONTENT RECOMMENDATION instead
 * of being emitted with a manufactured value. Competitor/SERP study only ever
 * selects WHICH types to aim for — it never supplies content.
 *
 * `source` values map to concrete inputs the generator already has:
 *   - page.*        → PageFeatures / target fields captured from the page
 *   - derived.*     → computed deterministically from page facts (e.g. brand)
 *   - page.body.extract → EXTRACTIVE LLM: value must appear verbatim/condensed
 *                         from the captured page text; null when absent.
 *   - existing.jsonld → re-used from the page's own existing JSON-LD blocks
 *   - config.*      → run configuration (country, language)
 *   - constant      → fixed by the standard (e.g. @context)
 */
import "server-only";
import type { PageType } from "@/lib/page-gap-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValueSource =
	| "page.title" // <title> / target.title
	| "page.h1" // features.h1Text
	| "page.metaDescription" // target.metaDescription
	| "page.url" // target.finalUrl || targetUrl
	| "page.origin" // origin of the URL
	| "page.domain" // target.domain
	| "page.breadcrumbPath" // derived from the URL path segments
	| "page.faqQuestions" // features.faqQuestions (visible Q headings)
	| "page.body.extract" // EXTRACTIVE LLM over captured page text
	| "derived.brand" // brandFromDomain(domain)
	| "derived.topic" // promptFinder.topic || keyword — a category label, not a page fact
	| "existing.jsonld" // value carried from the page's own JSON-LD
	| "config.country" // report.country
	| "config.language" // resolved page language (default "en")
	| "constant"; // fixed by the Schema.org standard

export type Requirement = "required" | "recommended" | "optional";

/**
 * Google rich-result eligibility status (as of the 2023–2025 changes).
 * Schema may still be worth emitting for GEO/LLM extraction even when no rich
 * result is available — see `geoValue`.
 */
export type RichResultStatus =
	| "active" // currently drives a Google rich result
	| "restricted" // rich result limited to a class of sites (e.g. FAQ → gov/health)
	| "deprecated" // rich result removed by Google
	| "none"; // never had a rich result (still useful for entities/GEO)

export type PropertySpec = {
	/** Schema.org property name (exact casing). */
	name: string;
	/** Human-readable expected range, for UI/standards docs. */
	expects: string;
	requirement: Requirement;
	cardinality: "single" | "multiple";
	/** Where the value legitimately comes from. */
	source: ValueSource;
	/**
	 * True ⇒ if the value is not on the page, DROP it and (if it was required)
	 * route the whole type to recommendations. NEVER fabricate.
	 * False ⇒ deterministically derivable from page facts (safe to always fill).
	 */
	pageGated: boolean;
	/**
	 * For `source: "constant"` properties only: the fixed value the standard wants
	 * (e.g. applicationCategory "BusinessApplication"). Reference-valued constants
	 * (provider/publisher/isPartOf/mainEntityOfPage) are resolved at build time
	 * from the graph @ids and do NOT use this.
	 */
	constValue?: unknown;
	/** Standards / Google note worth surfacing in the UI or the prompt. */
	note?: string;
};

export type SchemaSpec = {
	/** The @type value. */
	type: string;
	category: "foundation" | "primary" | "enhancement";
	description: string;
	/** Page types this type is relevant to ("all" = always a candidate). */
	appliesTo: PageType[] | "all";
	/** Page types for which this is THE primary entity of the page. */
	primaryFor: PageType[];
	richResult: RichResultStatus;
	googleDocs?: string;
	/** Why it matters for Generative Engine Optimization / AI extraction. */
	geoValue: string;
	properties: PropertySpec[];
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SCHEMA_REGISTRY: Record<string, SchemaSpec> = {
	// ---- Foundation entities (the always-on baseline) --------------------
	Organization: {
		type: "Organization",
		category: "foundation",
		description: "The publishing entity behind the site.",
		appliesTo: "all",
		primaryFor: [],
		richResult: "none",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/organization",
		geoValue: "Anchors the brand as a knowledge-graph entity AI engines can attribute statements to.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "derived.brand",
				pageGated: false,
			},
			{
				name: "url",
				expects: "URL",
				requirement: "required",
				cardinality: "single",
				source: "page.origin",
				pageGated: false,
			},
			{
				name: "logo",
				expects: "URL / ImageObject",
				requirement: "recommended",
				cardinality: "single",
				source: "existing.jsonld",
				pageGated: true,
				note: "Use only a real logo URL from the page/its JSON-LD; never guess a path.",
			},
			{
				name: "description",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Extract from an About/intro passage or reuse meta; omit if absent.",
			},
			{
				name: "sameAs",
				expects: "URL[]",
				requirement: "recommended",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
				note: "Only social/profile links actually linked on the page.",
			},
		],
	},
	WebSite: {
		type: "WebSite",
		category: "foundation",
		description: "The site as a whole; enables sitelinks/search box eligibility.",
		appliesTo: "all",
		primaryFor: [],
		richResult: "active",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox",
		geoValue: "Ties every page to one site entity, strengthening brand consolidation.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "derived.brand",
				pageGated: false,
			},
			{
				name: "url",
				expects: "URL",
				requirement: "required",
				cardinality: "single",
				source: "page.origin",
				pageGated: false,
			},
			{
				name: "publisher",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
				note: "Reference the Organization @id.",
			},
			{
				name: "inLanguage",
				expects: "Text (BCP-47)",
				requirement: "recommended",
				cardinality: "single",
				source: "config.language",
				pageGated: false,
			},
			{
				name: "potentialAction",
				expects: "SearchAction",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only when the site exposes a real on-site search endpoint.",
			},
		],
	},
	WebPage: {
		type: "WebPage",
		category: "foundation",
		description: "This specific URL as a page entity.",
		appliesTo: "all",
		primaryFor: ["unknown", "forum"],
		richResult: "none",
		geoValue: "Gives the URL a stable @id other nodes (breadcrumb, primary entity) hang off.",
		properties: [
			{
				name: "url",
				expects: "URL",
				requirement: "required",
				cardinality: "single",
				source: "page.url",
				pageGated: false,
			},
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.metaDescription",
				pageGated: true,
				note: "Prefer the real meta description; extract a summary or omit if none.",
			},
			{
				name: "isPartOf",
				expects: "WebSite ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "inLanguage",
				expects: "Text (BCP-47)",
				requirement: "recommended",
				cardinality: "single",
				source: "config.language",
				pageGated: false,
			},
			{
				name: "breadcrumb",
				expects: "BreadcrumbList ref",
				requirement: "optional",
				cardinality: "single",
				source: "page.breadcrumbPath",
				pageGated: false,
				note: "Only when a breadcrumb is planned.",
			},
			{
				name: "dateModified",
				expects: "Date",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real on-page modified date; hasDateSignal alone is not a date.",
			},
		],
	},

	// ---- Primary entities (one per page, chosen by page type) ------------
	Service: {
		type: "Service",
		category: "primary",
		description: "A service offered by the organization.",
		appliesTo: ["product_service", "hybrid"],
		primaryFor: ["product_service"],
		richResult: "none",
		geoValue: "Lets AI engines name the exact service + provider when answering commercial queries.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "serviceType",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.h1",
				pageGated: false,
			},
			{
				name: "provider",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "areaServed",
				expects: "Text / Place",
				requirement: "optional",
				cardinality: "single",
				source: "config.country",
				pageGated: false,
			},
			{
				name: "offers",
				expects: "Offer (price)",
				requirement: "optional",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
				note: "NEVER invent a price; only mark up a price shown on the page.",
			},
			{
				name: "aggregateRating",
				expects: "AggregateRating",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only when real ratings are visible on the page.",
			},
		],
	},
	Article: {
		type: "Article",
		category: "primary",
		description: "An editorial article / guide.",
		appliesTo: ["blog_guide", "comparison", "hybrid"],
		primaryFor: ["blog_guide", "comparison"],
		richResult: "active",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/article",
		geoValue: "Carries authorship/date signals AI engines weigh for E-E-A-T and recency.",
		// Google lists NO required Article properties (verified 2026-06) — all are
		// recommended. headline is our entity name so it is always page-sourced.
		properties: [
			{
				name: "headline",
				expects: "Text (≤110 chars)",
				requirement: "recommended",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.metaDescription",
				pageGated: true,
			},
			{
				name: "image",
				expects: "URL / ImageObject",
				requirement: "recommended",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
				note: "Use a real on-page/OG image URL only.",
			},
			{
				name: "author",
				expects: "Person / Organization",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "hasAuthorSignal is only a boolean — extract the real byline name or omit.",
			},
			{
				name: "datePublished",
				expects: "Date",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "dateModified",
				expects: "Date",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "publisher",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "mainEntityOfPage",
				expects: "WebPage ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "inLanguage",
				expects: "Text (BCP-47)",
				requirement: "optional",
				cardinality: "single",
				source: "config.language",
				pageGated: false,
			},
		],
	},
	NewsArticle: {
		type: "NewsArticle",
		category: "primary",
		description: "A news report (time-sensitive article).",
		appliesTo: ["news"],
		primaryFor: ["news"],
		richResult: "active",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/article",
		geoValue: "Recency + publisher signals AI news surfaces rely on.",
		// Google lists NO required NewsArticle properties (verified 2026-06).
		properties: [
			{
				name: "headline",
				expects: "Text (≤110 chars)",
				requirement: "recommended",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.metaDescription",
				pageGated: true,
			},
			{
				name: "image",
				expects: "URL / ImageObject",
				requirement: "recommended",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "datePublished",
				expects: "Date",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Strongly advised for news/Top Stories freshness; only a real published date.",
			},
			{
				name: "dateModified",
				expects: "Date",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "author",
				expects: "Person / Organization",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "publisher",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "mainEntityOfPage",
				expects: "WebPage ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
		],
	},
	WebApplication: {
		type: "WebApplication",
		category: "primary",
		description: "An interactive web-based tool/app.",
		appliesTo: ["tool"],
		primaryFor: ["tool"],
		richResult: "none",
		geoValue: "Names the tool + category so AI can recommend it for task queries.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.metaDescription",
				pageGated: true,
			},
			{
				name: "applicationCategory",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
				note: "Default 'BusinessApplication' unless the page states otherwise.",
			},
			{
				name: "url",
				expects: "URL",
				requirement: "required",
				cardinality: "single",
				source: "page.url",
				pageGated: false,
			},
			{
				name: "offers",
				expects: "Offer (price)",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Use 'price':'0' only if the page actually states it is free.",
			},
			{
				name: "aggregateRating",
				expects: "AggregateRating",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
		],
	},
	CollectionPage: {
		type: "CollectionPage",
		category: "primary",
		description: "A category/listing page that groups other entities.",
		appliesTo: ["category"],
		primaryFor: ["category"],
		richResult: "none",
		geoValue: "Signals a hub page so AI understands the page indexes a set, not a single answer.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.metaDescription",
				pageGated: true,
			},
			{
				name: "url",
				expects: "URL",
				requirement: "required",
				cardinality: "single",
				source: "page.url",
				pageGated: false,
			},
		],
	},
	Product: {
		type: "Product",
		category: "primary",
		description: "A purchasable product.",
		appliesTo: ["product_service"],
		primaryFor: [],
		richResult: "active",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/product",
		geoValue: "Price/availability/rating are the facts AI shopping answers quote directly.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "image",
				expects: "URL / ImageObject",
				requirement: "recommended",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.metaDescription",
				pageGated: true,
			},
			{
				name: "brand",
				expects: "Brand / Organization",
				requirement: "recommended",
				cardinality: "single",
				source: "derived.brand",
				pageGated: false,
			},
			{
				name: "offers",
				expects: "Offer (price, priceCurrency, availability)",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Effectively required for merchant-listing eligibility (price + priceCurrency). Must be the real on-page values — never invent; if no price on page, emit Product without offers and recommend adding it.",
			},
			{
				name: "aggregateRating",
				expects: "AggregateRating",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only real, visible review counts/ratings.",
			},
			{
				name: "sku",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
		],
	},

	// ---- Enhancements (added alongside the primary entity) ---------------
	BreadcrumbList: {
		type: "BreadcrumbList",
		category: "enhancement",
		description: "The page's position in the site hierarchy.",
		appliesTo: "all",
		primaryFor: [],
		richResult: "active",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/breadcrumb",
		geoValue: "Gives AI the topical path/parent context of the page.",
		properties: [
			{
				name: "itemListElement",
				expects: "ListItem[] (position,name,item)",
				requirement: "required",
				cardinality: "multiple",
				source: "page.breadcrumbPath",
				pageGated: false,
				note: "Derived deterministically from the URL path; safe to always build when ≥2 segments.",
			},
		],
	},
	FAQPage: {
		type: "FAQPage",
		category: "enhancement",
		description: "A list of question/answer pairs present on the page.",
		appliesTo: "all",
		primaryFor: [],
		richResult: "deprecated",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/faqpage",
		// Google fully removed the FAQ rich result in May 2026 (was previously
		// restricted to gov/health). Still emitted: high GEO value for LLM lift.
		geoValue:
			"High GEO value — LLMs/AI answers lift Q&A passages verbatim; the Google rich result itself was removed May 2026, so emit for AI extraction, not for a SERP feature.",
		properties: [
			{
				name: "mainEntity",
				expects: "Question[] (name + acceptedAnswer.text)",
				requirement: "required",
				cardinality: "multiple",
				source: "page.faqQuestions",
				pageGated: true,
				note: "Questions from visible headings; ANSWERS must be extracted from page text or reused from existing JSON-LD. If an answer is not on the page, do NOT mark it up — recommend adding the content.",
			},
		],
	},
	Person: {
		type: "Person",
		category: "enhancement",
		description: "A named author/expert (E-E-A-T attribution).",
		appliesTo: ["blog_guide", "news", "comparison"],
		primaryFor: [],
		richResult: "none",
		geoValue: "Attaches a real human author entity AI engines weigh for expertise/authority.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Extract the real byline; the page only carries a boolean author signal, so omit (and recommend a byline) if no name is present.",
			},
			{
				name: "url",
				expects: "URL",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "jobTitle",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
		],
	},
	HowTo: {
		type: "HowTo",
		category: "enhancement",
		description: "Step-by-step instructions present on the page.",
		appliesTo: ["blog_guide"],
		primaryFor: [],
		richResult: "deprecated",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/how-to",
		geoValue: "Still useful for AI procedural answers though Google removed the rich result in 2023.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.h1",
				pageGated: false,
			},
			{
				name: "step",
				expects: "HowToStep[] (name,text)",
				requirement: "required",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
				note: "Steps must be the real on-page steps; do not invent a procedure.",
			},
		],
	},
	VideoObject: {
		type: "VideoObject",
		category: "enhancement",
		description: "A video embedded on the page.",
		appliesTo: "all",
		primaryFor: [],
		richResult: "active",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/video",
		geoValue: "Surfaces the page in video answers; AI can cite the clip.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "thumbnailUrl",
				expects: "URL[]",
				requirement: "required",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "uploadDate",
				expects: "Date",
				requirement: "required",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "hasVideo is only a boolean — emit only when the real video metadata is recoverable.",
			},
			{
				name: "contentUrl",
				expects: "URL",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
		],
	},

	// ---- Industry-specific entities ---------------------------------------
	// Never `primaryFor` a PageType (they don't replace the page-format primary
	// like Article/Service); they are ADDED as extra entities when the detected
	// industry, the sourced gap findings, or competitor schema call for them. The
	// money/medical/legal FACTS they carry are all `pageGated` — emitted only when
	// present on the page, otherwise routed to a content recommendation.
	LoanOrCredit: {
		type: "LoanOrCredit",
		category: "primary",
		description: "A loan or credit product (subtype of FinancialProduct).",
		appliesTo: ["product_service", "hybrid", "blog_guide", "comparison", "category"],
		primaryFor: [],
		richResult: "none",
		geoValue:
			"Names the exact lending product + provider and (when present) its rate/term/amount — the facts AI answers quote for loan queries.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "provider",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "loanType",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "derived.topic",
				pageGated: false,
			},
			{
				name: "areaServed",
				expects: "Country / Place",
				requirement: "optional",
				cardinality: "single",
				source: "config.country",
				pageGated: false,
			},
			{
				name: "annualPercentageRate",
				expects: "Number / QuantitativeValue",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real APR stated on the page — never invent or estimate a rate (YMYL).",
			},
			{
				name: "amount",
				expects: "MonetaryAmount",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real loan amount/range stated on the page.",
			},
			{
				name: "loanTerm",
				expects: "QuantitativeValue (months)",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real tenure/term stated on the page.",
			},
		],
	},
	FinancialProduct: {
		type: "FinancialProduct",
		category: "primary",
		description: "A banking, investment, or insurance financial product.",
		appliesTo: ["product_service", "hybrid", "blog_guide", "comparison", "category"],
		primaryFor: [],
		richResult: "none",
		geoValue: "Identifies the financial product + provider so AI can attribute terms and fees to the right offering.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "provider",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "category",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "derived.topic",
				pageGated: false,
			},
			{
				name: "areaServed",
				expects: "Country / Place",
				requirement: "optional",
				cardinality: "single",
				source: "config.country",
				pageGated: false,
			},
			{
				name: "interestRate",
				expects: "Number / QuantitativeValue",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real rate stated on the page (YMYL).",
			},
			{
				name: "feesAndCommissionsSpecification",
				expects: "Text / URL",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only real fee terms stated on the page.",
			},
		],
	},
	SoftwareApplication: {
		type: "SoftwareApplication",
		category: "primary",
		description: "A software application or interactive tool (parent of WebApplication).",
		appliesTo: ["tool", "product_service", "hybrid"],
		primaryFor: [],
		richResult: "none",
		geoValue: "Names the tool + category so AI can recommend it for task queries; carries price/rating when present.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "applicationCategory",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
				constValue: "BusinessApplication",
			},
			{
				name: "operatingSystem",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "constant",
				pageGated: false,
				constValue: "Web",
			},
			{
				name: "url",
				expects: "URL",
				requirement: "required",
				cardinality: "single",
				source: "page.url",
				pageGated: false,
			},
			{
				name: "provider",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "offers",
				expects: "Offer (price)",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Use price '0' only if the page states it is free; otherwise the real price.",
			},
			{
				name: "aggregateRating",
				expects: "AggregateRating",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
		],
	},
	MedicalWebPage: {
		type: "MedicalWebPage",
		category: "primary",
		description: "A page whose primary content is medical/health information.",
		appliesTo: ["blog_guide", "product_service", "hybrid", "comparison"],
		primaryFor: [],
		richResult: "none",
		geoValue:
			"Flags medical content + (when present) its reviewer/last-reviewed date — the E-E-A-T signals AI weighs for health YMYL.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "lastReviewed",
				expects: "Date",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real medical-review date shown on the page.",
			},
			{
				name: "reviewedBy",
				expects: "Person / Organization",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real, named medical reviewer credited on the page.",
			},
		],
	},
	Drug: {
		type: "Drug",
		category: "enhancement",
		description: "A medication/drug discussed on the page.",
		appliesTo: ["blog_guide", "comparison", "hybrid"],
		primaryFor: [],
		richResult: "none",
		geoValue: "Identifies the drug entity so AI can attach dosage/ingredient facts present on the page.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.h1",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "activeIngredient",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only ingredients stated on the page (YMYL).",
			},
			{
				name: "dosageForm",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
		],
	},
	MedicalCondition: {
		type: "MedicalCondition",
		category: "enhancement",
		description: "A medical condition discussed on the page.",
		appliesTo: ["blog_guide", "comparison", "hybrid"],
		primaryFor: [],
		richResult: "none",
		geoValue: "Names the condition entity so AI can attach symptoms/treatments present on the page.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.h1",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "signOrSymptom",
				expects: "Text",
				requirement: "optional",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
				note: "Only symptoms listed on the page (YMYL).",
			},
			{
				name: "possibleTreatment",
				expects: "Text",
				requirement: "optional",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
				note: "Only treatments stated on the page (YMYL).",
			},
		],
	},
	LegalService: {
		type: "LegalService",
		category: "primary",
		description: "A legal service offered by a firm/attorney.",
		appliesTo: ["product_service", "hybrid", "category"],
		primaryFor: [],
		richResult: "none",
		geoValue: "Names the legal service + provider + area served for commercial legal queries.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "provider",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "serviceType",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "derived.topic",
				pageGated: false,
			},
			{
				name: "areaServed",
				expects: "Country / Place",
				requirement: "optional",
				cardinality: "single",
				source: "config.country",
				pageGated: false,
			},
			{
				name: "priceRange",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real fee/price range stated on the page.",
			},
		],
	},
	RealEstateListing: {
		type: "RealEstateListing",
		category: "primary",
		description: "A property listing.",
		appliesTo: ["product_service", "category", "hybrid"],
		primaryFor: [],
		richResult: "none",
		geoValue:
			"Identifies the listing entity so AI can surface the property and (when present) its price/posting date.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "url",
				expects: "URL",
				requirement: "required",
				cardinality: "single",
				source: "page.url",
				pageGated: false,
			},
			{
				name: "datePosted",
				expects: "Date",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real listing date shown on the page.",
			},
		],
	},
	Course: {
		type: "Course",
		category: "primary",
		description: "An educational course.",
		appliesTo: ["product_service", "blog_guide", "hybrid", "category"],
		primaryFor: [],
		richResult: "active",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/course",
		geoValue: "Names the course + provider so AI can recommend it for learning queries.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "provider",
				expects: "Organization ref",
				requirement: "recommended",
				cardinality: "single",
				source: "constant",
				pageGated: false,
			},
			{
				name: "courseMode",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "educationalCredentialAwarded",
				expects: "Text",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
		],
	},
	Car: {
		type: "Car",
		category: "primary",
		description: "A car/vehicle (subtype of Product).",
		appliesTo: ["product_service", "comparison", "category", "hybrid"],
		primaryFor: [],
		richResult: "none",
		geoValue: "Names the vehicle + brand and (when present) price — the facts AI shopping answers quote.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "brand",
				expects: "Brand / Organization",
				requirement: "recommended",
				cardinality: "single",
				source: "derived.brand",
				pageGated: false,
			},
			{
				name: "offers",
				expects: "Offer (price, priceCurrency)",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
				note: "Only a real price shown on the page.",
			},
		],
	},
	Recipe: {
		type: "Recipe",
		category: "primary",
		description: "A cooking recipe.",
		appliesTo: ["blog_guide", "hybrid"],
		primaryFor: [],
		richResult: "active",
		googleDocs: "https://developers.google.com/search/docs/appearance/structured-data/recipe",
		geoValue: "Carries ingredients/steps AI lifts for recipe answers.",
		properties: [
			{
				name: "name",
				expects: "Text",
				requirement: "required",
				cardinality: "single",
				source: "page.title",
				pageGated: false,
			},
			{
				name: "description",
				expects: "Text",
				requirement: "recommended",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "author",
				expects: "Person / Organization",
				requirement: "optional",
				cardinality: "single",
				source: "page.body.extract",
				pageGated: true,
			},
			{
				name: "recipeIngredient",
				expects: "Text[]",
				requirement: "recommended",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
				note: "Only ingredients actually listed on the page.",
			},
			{
				name: "recipeInstructions",
				expects: "HowToStep[] / Text",
				requirement: "recommended",
				cardinality: "multiple",
				source: "page.body.extract",
				pageGated: true,
				note: "Only the real steps listed on the page.",
			},
		],
	},
};

// ---------------------------------------------------------------------------
// Aliases — normalise common variants to a canonical registry key.
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
	faq: "FAQPage",
	faqpage: "FAQPage",
	breadcrumb: "BreadcrumbList",
	breadcrumblist: "BreadcrumbList",
	webapp: "WebApplication",
	loancredit: "LoanOrCredit",
	financialservice: "FinancialProduct",
	bankaccount: "FinancialProduct",
	creditcard: "FinancialProduct",
	investmentordeposit: "FinancialProduct",
	vehicle: "Car",
	blogposting: "Article",
	article: "Article",
	newsarticle: "NewsArticle",
	collectionpage: "CollectionPage",
	itempage: "WebPage",
	localbusiness: "Organization",
};

export function canonicalType(raw: string): string | null {
	const key = String(raw || "").trim();
	if (!key) return null;
	if (SCHEMA_REGISTRY[key]) return key;
	const lower = key.toLowerCase();
	if (ALIASES[lower]) return ALIASES[lower];
	// case-insensitive exact match against registry keys
	const hit = Object.keys(SCHEMA_REGISTRY).find(k => k.toLowerCase() === lower);
	return hit ?? null;
}

// ---------------------------------------------------------------------------
// Query helpers — the API the generator reads instead of hard-coding.
// ---------------------------------------------------------------------------

export function getSpec(type: string): SchemaSpec | null {
	const c = canonicalType(type);
	return c ? SCHEMA_REGISTRY[c] : null;
}

/** Foundation types every page should carry. */
export function foundationTypes(): string[] {
	return Object.values(SCHEMA_REGISTRY)
		.filter(s => s.category === "foundation")
		.map(s => s.type);
}

/** The primary entity type for a page type (first registry match). */
export function primaryTypeFor(pt: PageType): string {
	const hit = Object.values(SCHEMA_REGISTRY).find(s => s.primaryFor.includes(pt));
	return hit?.type ?? "WebPage";
}

/** All types that are candidates for a given page type. */
export function candidateTypesFor(pt: PageType): string[] {
	return Object.values(SCHEMA_REGISTRY)
		.filter(s => s.appliesTo === "all" || s.appliesTo.includes(pt))
		.map(s => s.type);
}

export function requiredProps(type: string): PropertySpec[] {
	return getSpec(type)?.properties.filter(p => p.requirement === "required") ?? [];
}

/** Properties whose value must come from the page or be dropped (no invention). */
export function pageGatedProps(type: string): PropertySpec[] {
	return getSpec(type)?.properties.filter(p => p.pageGated) ?? [];
}

/**
 * The fields that need extraction from the captured page text for a given type.
 * Drives the EXTRACTIVE LLM prompt (locate-don't-author).
 */
export function extractionFieldsFor(type: string): PropertySpec[] {
	return getSpec(type)?.properties.filter(p => p.source === "page.body.extract") ?? [];
}

/** Is this type currently eligible for a Google rich result on a typical site? */
export function isRichResultEligible(type: string): boolean {
	return getSpec(type)?.richResult === "active";
}

// ---------------------------------------------------------------------------
// Industry → signature schema types.
//
// Keyed by the EXACT industry label the Prompt Finder emits (see
// `INDUSTRIES` in lib/prompt-finder.ts). These are the industry-specific
// entities a commercial/relevant page in that vertical should carry IN ADDITION
// to its page-format primary (Article/Service/…). Selection is still gated by
// page type (the spec's `appliesTo`) and by commercial/gap/SERP signals in
// `buildSchemaPlan` — this map only says "for this vertical, aim for these".
// Deeper, less universal types (Drug, MedicalCondition, …) are intentionally
// NOT auto-added here; they remain reachable via the sourced gap findings and
// competitor-schema tally.
// ---------------------------------------------------------------------------

export const INDUSTRY_SCHEMA: Record<string, string[]> = {
	"Lending & credit (finance)": ["LoanOrCredit"],
	"Banking & payments (finance)": ["FinancialProduct"],
	"Investing & wealth (finance)": ["FinancialProduct"],
	"Insurance (finance)": ["FinancialProduct"],
	"Health & medical": ["MedicalWebPage"],
	"Legal services": ["LegalService"],
	"Real estate & property": ["RealEstateListing"],
	"SaaS & software": ["SoftwareApplication"],
	"E-commerce & retail": ["Product"],
	"Education & courses": ["Course"],
	Automotive: ["Car"],
	"Food & recipes": ["Recipe"],
};

/** The industry-specific schema types to aim for, given a Prompt Finder industry label. */
export function industrySchemaTypes(industryLabel: string | null | undefined): string[] {
	if (!industryLabel) return [];
	return INDUSTRY_SCHEMA[industryLabel] ?? [];
}
