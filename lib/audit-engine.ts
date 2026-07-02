/**
 * GEO Audit Engine - site crawler edition
 *
 * The audit is intentionally deterministic: it fetches public website files,
 * crawls internal HTML pages, parses concrete page signals, and scores against
 * GEO best-practice rules. LLMs can help users rewrite content, but they should
 * not invent audit evidence.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "pass";
export type Dimension = "citability" | "structural" | "multimodal" | "authority" | "technical";

export type Finding = {
	severity: Severity;
	category: string;
	title: string;
	problem: string;
	fix: string;
	evidence?: string;
	sop_ref?: string;
	dimension: Dimension;
};

export type CrawledPageSummary = {
	url: string;
	title: string;
	status: number;
	wordCount: number;
	h1Count: number;
	h2Count: number;
	schemaTypes: string[];
	issues: string[];
};

/** Compact, persistable parsed signals for a single page (for UI + the AI agent). */
export type PageSignals = {
	h1: string[];
	h2: string[];
	h3: string[];
	schemaTypes: string[];
	canonical: string | null;
	metaDescription: string;
	imageCount: number;
	imagesWithoutAlt: number;
	tableCount: number;
	listCount: number;
	internalLinks: number;
	externalLinks: number;
	qualityExternalLinks: number;
	questionHeadings: number;
	statMatches: number;
	hasFaq: boolean;
	hasVideo: boolean;
	hasAuthorSignal: boolean;
	hasDateSignal: boolean;
	hasOpenGraph: boolean;
	hasViewport: boolean;
	hasLang: boolean;
	hasClientRenderRisk: boolean;
};

/** Full per-page record: stored HTML + parsed signals + rule verdicts. */
export type AuditPageRecord = {
	url: string;
	requestedUrl: string;
	status: number;
	ok: boolean;
	title: string;
	metaDescription: string;
	wordCount: number;
	htmlBytes: number;
	html: string;
	text: string;
	signals: PageSignals;
	ruleIssues: string[];
	working: string[];
	notWorking: string[];
};

export type AuditResult = {
	url: string;
	fetchedAt: string;
	score: number;
	dimensions: Record<Dimension, number>;
	findings: Finding[];
	pages: AuditPageRecord[];
	stats: {
		httpsOk: boolean;
		responseMs: number;
		wordCount: number;
		schemaTypes: string[];
		hasLlmsTxt: boolean;
		blockedCrawlers: string[];
		tableCount: number;
		hasCanonical: boolean;
		hasLang: boolean;
		hasViewport: boolean;
		hasOpenGraph: boolean;
		hasSitemap: boolean;
		h1Count: number;
		h2Count: number;
		h3Count: number;
		questionHeadings: number;
		hasFaqSchema: boolean;
		listCount: number;
		imageCount: number;
		imagesWithoutAlt: number;
		hasVideoEmbed: boolean;
		internalLinks: number;
		externalLinks: number;
		qualityExternalLinks: number;
		hasAuthorSignal: boolean;
		hasDateSignal: boolean;
		optimalParagraphs: number;
		longParagraphs: number;
		hasAboutPage: boolean;
		hasContactPage: boolean;
		lastModified: string | null;
		crawledPages: number;
		discoveredUrls: number;
		checkedFiles: string[];
		failedPages: number;
		averageWordsPerPage: number;
		thinPages: number;
		clientRenderedPages: number;
		duplicateTitleCount: number;
		pagesWithoutCanonical: number;
		pagesWithoutSchema: number;
		pagesWithoutAuthor: number;
		pagesWithoutDate: number;
		pagesWithoutQuestionHeadings: number;
		pagesWithFaq: number;
		pagesWithTables: number;
		pagesWithVideo: number;
		pagesWithQualityCitations: number;
		pdfCount: number;
		documentCount: number;
		imageFileCount: number;
		crawledPageSummaries: CrawledPageSummary[];
	};
};

type RobotsGroup = {
	agents: string[];
	disallow: string[];
	allow: string[];
};

type ResourceStatus = {
	path: string;
	ok: boolean;
	status?: number;
	content: string;
	url: string;
};

type LinkInfo = {
	url: string;
	text: string;
	kind: "internal" | "external" | "file";
};

export type PageAnalysis = {
	url: string;
	finalUrl: string;
	status: number;
	ok: boolean;
	contentType: string;
	lastModified: string | null;
	fetchMs: number;
	html: string;
	text: string;
	title: string;
	metaDescription: string;
	canonical: string | null;
	h1Texts: string[];
	h2Texts: string[];
	h3Texts: string[];
	paragraphWordCounts: number[];
	schemaTypes: string[];
	links: LinkInfo[];
	tableCount: number;
	listCount: number;
	imageCount: number;
	imagesWithoutAlt: number;
	hasVideoEmbed: boolean;
	hasFaqStructure: boolean;
	hasFaqSchema: boolean;
	hasAuthorSignal: boolean;
	hasDateSignal: boolean;
	hasLang: boolean;
	hasViewport: boolean;
	hasOpenGraph: boolean;
	hasClientRenderRisk: boolean;
	wordCount: number;
	questionHeadings: number;
	optimalParagraphs: number;
	longParagraphs: number;
	statMatches: number;
	externalLinks: number;
	qualityExternalLinks: number;
	internalLinks: number;
	fileLinks: LinkInfo[];
	issues: string[];
};

const MAX_CRAWL_PAGES = 40;
const MAX_SITEMAP_URLS = 120;
const MAX_SITEMAPS = 12;
const FETCH_TIMEOUT_MS = 15000;

const AI_RETRIEVAL_CRAWLERS = [
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	"PerplexityBot",
	"ClaudeBot",
	"Claude-SearchBot",
	"Googlebot",
];

const TRAINING_CRAWLERS = ["CCBot", "anthropic-ai", "Bytespider", "cohere-ai"];

const QUESTION_WORDS = /^(who|what|when|where|why|how|is|are|can|does|do|should|will|which|was|were|has|have|did)\b/i;

const AUTHOR_PATTERN = /\b(by|author[:\s]|written by|posted by|published by|reviewed by)\s+[A-Z][a-zA-Z\s\-'.]{2,50}/i;

const DATE_PATTERN =
	/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}/i;

const FILE_EXT_PATTERN = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|jpg|jpeg|png|webp|gif|svg)(\?|#|$)/i;

const UA = "Mozilla/5.0 (compatible; FirstRankerGEOBot/2.0; +https://thefirstranker.app)";

const DIMENSION_WEIGHTS: Record<Dimension, number> = {
	citability: 0.25,
	structural: 0.2,
	multimodal: 0.15,
	authority: 0.2,
	technical: 0.2,
};

const SEVERITY_PENALTY: Record<Severity, number> = {
	critical: 30,
	high: 15,
	medium: 7,
	low: 3,
	pass: 0,
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "pass"];

export function normaliseUrl(input: string): URL {
	let s = input.trim();
	if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
	const url = new URL(s);
	url.hash = "";
	return url;
}

function canonicalizeUrl(input: string | URL, base?: string | URL): string | null {
	try {
		const url = typeof input === "string" ? new URL(input, base) : new URL(input.toString());
		if (!["http:", "https:"].includes(url.protocol)) return null;
		url.hash = "";
		if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
			url.port = "";
		}
		if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
		return url.toString();
	} catch {
		return null;
	}
}

async function safeFetch(url: string, timeoutMs = FETCH_TIMEOUT_MS) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	const start = Date.now();
	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain,*/*",
			},
			redirect: "follow",
			signal: ctrl.signal,
		});
		return { response, ms: Date.now() - start };
	} finally {
		clearTimeout(t);
	}
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(html: string): string {
	return decodeHtmlEntities(
		html
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

function attrValue(attrs: string, name: string): string | null {
	const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
	const match = attrs.match(re);
	return match ? decodeHtmlEntities(match[1].trim()) : null;
}

function extractTagContent(html: string, tag: string): string[] {
	const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
	const out: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = re.exec(html))) out.push(stripTags(match[1]));
	return out.filter(Boolean);
}

function extractMetaContent(html: string, name: string): string {
	const re = new RegExp(`<meta([^>]*(?:name|property)=["']${name}["'][^>]*)>`, "i");
	const match = html.match(re);
	return match ? (attrValue(match[1], "content") ?? "") : "";
}

function extractTitle(html: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match ? stripTags(match[1]) : "";
}

function extractCanonical(html: string, baseUrl: string): string | null {
	const match = html.match(/<link([^>]+rel=["']canonical["'][^>]*)>/i);
	const href = match ? attrValue(match[1], "href") : null;
	return href ? canonicalizeUrl(href, baseUrl) : null;
}

function extractJsonLdTypes(html: string): string[] {
	const types = new Set<string>();
	const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let match: RegExpExecArray | null;

	while ((match = re.exec(html))) {
		try {
			const json = JSON.parse(decodeHtmlEntities(match[1].trim()));
			const collect = (node: unknown) => {
				if (!node) return;
				if (Array.isArray(node)) {
					node.forEach(collect);
					return;
				}
				if (typeof node !== "object") return;
				const obj = node as Record<string, unknown>;
				const type = obj["@type"];
				if (typeof type === "string") types.add(type);
				if (Array.isArray(type))
					type.forEach(t => {
						types.add(String(t));
					});
				if (obj["@graph"]) collect(obj["@graph"]);
				if (obj.mainEntity) collect(obj.mainEntity);
				if (obj.author) collect(obj.author);
				if (obj.publisher) collect(obj.publisher);
			};
			collect(json);
		} catch {
			/* Ignore malformed JSON-LD. A separate schema validator can flag syntax. */
		}
	}
	return [...types];
}

function extractParagraphWordCounts(html: string): number[] {
	return extractTagContent(html, "p")
		.map(p => p.split(/\s+/).filter(Boolean).length)
		.filter(count => count > 10);
}

function analyseImages(html: string): { total: number; missingAlt: number } {
	const re = /<img([^>]*)>/gi;
	let total = 0;
	let missingAlt = 0;
	let match: RegExpExecArray | null;

	while ((match = re.exec(html))) {
		total++;
		const alt = attrValue(match[1], "alt");
		if (alt === null || alt.trim() === "") missingAlt++;
	}

	return { total, missingAlt };
}

function extractLinks(html: string, pageUrl: string, originHost: string): LinkInfo[] {
	const links: LinkInfo[] = [];
	const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
	let match: RegExpExecArray | null;

	while ((match = re.exec(html))) {
		const href = attrValue(match[1], "href");
		if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
			continue;
		}
		const canonical = canonicalizeUrl(href, pageUrl);
		if (!canonical) continue;
		const parsed = new URL(canonical);
		const text = stripTags(match[2]).slice(0, 120);
		const kind = FILE_EXT_PATTERN.test(parsed.pathname)
			? "file"
			: parsed.host === originHost
				? "internal"
				: "external";
		links.push({ url: canonical, text, kind });
	}

	return links;
}

function isHtmlResponse(response: Response, url: string): boolean {
	const type = response.headers.get("content-type") ?? "";
	return type.includes("text/html") || (!type && !FILE_EXT_PATTERN.test(url));
}

function parseRobotsGroups(robotsTxt: string): RobotsGroup[] {
	const groups: RobotsGroup[] = [];
	let current: RobotsGroup | null = null;

	for (const raw of robotsTxt.split(/\r?\n/)) {
		const line = raw.split("#")[0].trim();
		if (!line) {
			current = null;
			continue;
		}
		const [rawKey, ...rest] = line.split(":");
		const key = rawKey.trim().toLowerCase();
		const value = rest.join(":").trim();
		if (!value && key !== "disallow") continue;

		if (key === "user-agent") {
			if (!current) {
				current = { agents: [], disallow: [], allow: [] };
				groups.push(current);
			}
			current.agents.push(value);
		} else if (current && key === "disallow") {
			current.disallow.push(value);
		} else if (current && key === "allow") {
			current.allow.push(value);
		}
	}

	return groups;
}

function matchingRobotsGroups(groups: RobotsGroup[], agent: string): RobotsGroup[] {
	const exact = groups.filter(group => group.agents.some(a => a.toLowerCase() === agent.toLowerCase()));
	if (exact.length) return exact;
	return groups.filter(group => group.agents.includes("*"));
}

function pathMatchesRule(pathname: string, rule: string): boolean {
	if (!rule) return false;
	const normalized = rule.replace(/\*.*$/, "");
	return pathname.startsWith(normalized || "/");
}

function isPathAllowed(groups: RobotsGroup[], url: string, agent: string): boolean {
	const path = new URL(url).pathname || "/";
	const matching = matchingRobotsGroups(groups, agent);
	let longestAllow = 0;
	let longestDisallow = 0;

	for (const group of matching) {
		for (const allow of group.allow) {
			if (pathMatchesRule(path, allow)) longestAllow = Math.max(longestAllow, allow.length);
		}
		for (const disallow of group.disallow) {
			if (pathMatchesRule(path, disallow)) {
				longestDisallow = Math.max(longestDisallow, disallow.length);
			}
		}
	}

	return longestAllow >= longestDisallow || longestDisallow === 0;
}

function parseBlockedCrawlers(robotsTxt: string): string[] {
	const groups = parseRobotsGroups(robotsTxt);
	const origin = "https://example.com/";
	return AI_RETRIEVAL_CRAWLERS.filter(bot => !isPathAllowed(groups, origin, bot));
}

function extractSitemapUrls(robotsTxt: string): string[] {
	return robotsTxt
		.split(/\r?\n/)
		.map(line => line.match(/^\s*sitemap:\s*(.+)\s*$/i)?.[1]?.trim())
		.filter((value): value is string => !!value);
}

function extractXmlLocs(xml: string): string[] {
	const urls: string[] = [];
	const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(xml))) {
		urls.push(decodeHtmlEntities(match[1].trim()));
	}
	return urls;
}

function isLikelyPageUrl(url: string, originHost: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.host !== originHost) return false;
		if (FILE_EXT_PATTERN.test(parsed.pathname)) return false;
		if (/\.(css|js|json|xml|txt|ico|woff2?|ttf|eot)$/i.test(parsed.pathname)) return false;
		return true;
	} catch {
		return false;
	}
}

async function fetchResource(origin: string, path: string): Promise<ResourceStatus> {
	const url = `${origin}${path}`;
	try {
		const { response } = await safeFetch(url, 8000);
		const content = response.ok ? await response.text() : "";
		return { path, ok: response.ok, status: response.status, content, url };
	} catch {
		return { path, ok: false, content: "", url };
	}
}

async function discoverSitemapPages(
	origin: string,
	originHost: string,
	robotsTxt: string,
): Promise<{ hasSitemap: boolean; urls: string[]; sitemapUrls: string[] }> {
	const sitemapUrls = [...extractSitemapUrls(robotsTxt), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
	const queue = [...new Set(sitemapUrls)].slice(0, MAX_SITEMAPS);
	const seenSitemaps = new Set<string>();
	const pageUrls = new Set<string>();
	let hasSitemap = false;

	while (queue.length && seenSitemaps.size < MAX_SITEMAPS && pageUrls.size < MAX_SITEMAP_URLS) {
		const sitemapUrl = queue.shift()!;
		if (seenSitemaps.has(sitemapUrl)) continue;
		seenSitemaps.add(sitemapUrl);

		try {
			const { response } = await safeFetch(sitemapUrl, 8000);
			if (!response.ok) continue;
			hasSitemap = true;
			const xml = await response.text();
			for (const loc of extractXmlLocs(xml)) {
				const canonical = canonicalizeUrl(loc);
				if (!canonical) continue;
				if (/\.xml(\?|#|$)/i.test(new URL(canonical).pathname)) {
					if (queue.length + seenSitemaps.size < MAX_SITEMAPS) queue.push(canonical);
				} else if (isLikelyPageUrl(canonical, originHost)) {
					pageUrls.add(canonical);
					if (pageUrls.size >= MAX_SITEMAP_URLS) break;
				}
			}
		} catch {
			/* Sitemap discovery is best effort. */
		}
	}

	return {
		hasSitemap,
		urls: [...pageUrls],
		sitemapUrls: [...seenSitemaps],
	};
}

/** Build an empty (failed/unfetched) page analysis, optionally overriding fields. */
function emptyPageAnalysis(url: string, overrides: Partial<PageAnalysis> = {}): PageAnalysis {
	return {
		url,
		finalUrl: url,
		status: 0,
		ok: false,
		contentType: "",
		lastModified: null,
		fetchMs: 0,
		html: "",
		text: "",
		title: "",
		metaDescription: "",
		canonical: null,
		h1Texts: [],
		h2Texts: [],
		h3Texts: [],
		paragraphWordCounts: [],
		schemaTypes: [],
		links: [],
		tableCount: 0,
		listCount: 0,
		imageCount: 0,
		imagesWithoutAlt: 0,
		hasVideoEmbed: false,
		hasFaqStructure: false,
		hasFaqSchema: false,
		hasAuthorSignal: false,
		hasDateSignal: false,
		hasLang: false,
		hasViewport: false,
		hasOpenGraph: false,
		hasClientRenderRisk: false,
		wordCount: 0,
		questionHeadings: 0,
		optimalParagraphs: 0,
		longParagraphs: 0,
		statMatches: 0,
		externalLinks: 0,
		qualityExternalLinks: 0,
		internalLinks: 0,
		fileLinks: [],
		issues: [],
		...overrides,
	};
}

/**
 * Parse an already-fetched/rendered HTML document into the full PageAnalysis.
 * Fetch-free and pure, so it can be fed HTML captured by any source — including
 * a Playwright-rendered DOM (see lib/browser.ts). `originHost` is the host used
 * to classify links as internal vs external (pass the page's own host).
 */
export function analyzeRenderedHtml(
	html: string,
	requestedUrl: string,
	finalUrl: string,
	originHost: string,
	meta: {
		status?: number;
		lastModified?: string | null;
		contentType?: string;
		fetchMs?: number;
	} = {},
): PageAnalysis {
	const text = stripTags(html);
	const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
	const h1Texts = extractTagContent(html, "h1");
	const h2Texts = extractTagContent(html, "h2");
	const h3Texts = extractTagContent(html, "h3");
	const paragraphWordCounts = extractParagraphWordCounts(html);
	const schemaTypes = extractJsonLdTypes(html);
	const links = extractLinks(html, finalUrl, originHost);
	const imageStats = analyseImages(html);
	const externalLinks = links.filter(link => link.kind === "external").length;
	const qualityExternalLinks = links.filter(link => {
		if (link.kind !== "external") return false;
		try {
			const host = new URL(link.url).hostname;
			return /\.(gov|edu|org|ac\.[a-z]{2})$/i.test(host);
		} catch {
			return false;
		}
	}).length;

	const title = extractTitle(html);
	const hasFaqSchema = schemaTypes.some(type => type.toLowerCase() === "faqpage");
	const hasFaqStructure =
		hasFaqSchema || /<details[\s>]/i.test(html) || /\b(frequently asked|faq|questions and answers)\b/i.test(text);
	const questionHeadings = [...h2Texts, ...h3Texts].filter(h => QUESTION_WORDS.test(h)).length;
	const optimalParagraphs = paragraphWordCounts.filter(count => count >= 134 && count <= 167).length;
	const longParagraphs = paragraphWordCounts.filter(count => count > 250).length;
	const statMatches = (text.match(/\b\d+([.,]\d+)?\s?%|\b\d{2,}\b/g) || []).length;
	const hasAuthorSignal =
		AUTHOR_PATTERN.test(text) ||
		schemaTypes.includes("Person") ||
		/<[^>]+(?:class|rel|itemprop)=["'][^"']*author[^"']*["']/i.test(html);
	const hasDateSignal =
		DATE_PATTERN.test(text) ||
		/<time[^>]+datetime/i.test(html) ||
		/"datePublished"/.test(html) ||
		/"dateModified"/.test(html) ||
		/<meta[^>]+(?:article:published_time)/i.test(html);
	const hasOpenGraph =
		/<meta[^>]+property=["']og:title["']/i.test(html) && /<meta[^>]+property=["']og:description["']/i.test(html);
	const hasClientRenderRisk =
		wordCount < 120 &&
		/<script[^>]+(?:src|type=["']module["'])/i.test(html) &&
		/<div[^>]+id=["'](__next|root|app)["'][^>]*>\s*<\/div>/i.test(html);

	const issues: string[] = [];
	if (wordCount < 600) issues.push(`Thin content (${wordCount} words)`);
	if (h1Texts.length !== 1) issues.push(`${h1Texts.length} H1 tags`);
	if (h2Texts.length === 0 && wordCount > 300) issues.push("No H2 structure");
	if (questionHeadings === 0 && h2Texts.length + h3Texts.length > 0) issues.push("No question headings");
	if (!schemaTypes.length) issues.push("No JSON-LD schema");
	if (!hasAuthorSignal) issues.push("No author signal");
	if (!hasDateSignal) issues.push("No date signal");
	if (imageStats.missingAlt > 0) issues.push(`${imageStats.missingAlt} images missing alt`);
	if (hasClientRenderRisk) issues.push("Possible client-only rendering");

	return {
		url: requestedUrl,
		finalUrl,
		status: meta.status ?? 200,
		ok: true,
		contentType: meta.contentType ?? "text/html",
		lastModified: meta.lastModified ?? null,
		fetchMs: meta.fetchMs ?? 0,
		html,
		text,
		title,
		metaDescription: extractMetaContent(html, "description"),
		canonical: extractCanonical(html, finalUrl),
		h1Texts,
		h2Texts,
		h3Texts,
		paragraphWordCounts,
		schemaTypes,
		links,
		tableCount: (html.match(/<table[\s>]/gi) || []).length,
		listCount: (html.match(/<(ul|ol)[\s>]/gi) || []).length,
		imageCount: imageStats.total,
		imagesWithoutAlt: imageStats.missingAlt,
		hasVideoEmbed: /<iframe[^>]+(?:youtube|vimeo|youtu\.be)[^>]*>/i.test(html) || /<video[\s>]/i.test(html),
		hasFaqStructure,
		hasFaqSchema,
		hasAuthorSignal,
		hasDateSignal,
		hasLang: /<html[^>]+lang=["'][^"']+["']/i.test(html),
		hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
		hasOpenGraph,
		hasClientRenderRisk,
		wordCount,
		questionHeadings,
		optimalParagraphs,
		longParagraphs,
		statMatches,
		externalLinks,
		qualityExternalLinks,
		internalLinks: links.filter(link => link.kind === "internal").length,
		fileLinks: links.filter(link => link.kind === "file"),
		issues,
	};
}

async function analysePage(url: string, originHost: string): Promise<PageAnalysis> {
	const started = Date.now();
	try {
		const { response, ms } = await safeFetch(url);
		const contentType = response.headers.get("content-type") ?? "";
		const status = response.status;
		const finalUrl = response.url || url;
		const lastModified = response.headers.get("last-modified");

		if (!response.ok || !isHtmlResponse(response, finalUrl)) {
			return emptyPageAnalysis(url, {
				finalUrl,
				status,
				contentType,
				lastModified,
				fetchMs: ms,
				issues: [`Fetch returned ${status || "non-HTML response"}`],
			});
		}

		const html = await response.text();
		return analyzeRenderedHtml(html, url, finalUrl, originHost, {
			status,
			lastModified,
			contentType,
			fetchMs: ms,
		});
	} catch (error) {
		return emptyPageAnalysis(url, {
			fetchMs: Date.now() - started,
			issues: [`Fetch failed: ${(error as Error).message}`],
		});
	}
}

function pageList(pages: PageAnalysis[], predicate: (page: PageAnalysis) => boolean, limit = 5): string {
	return pages
		.filter(predicate)
		.slice(0, limit)
		.map(page => `${page.finalUrl} (${page.issues.slice(0, 3).join("; ") || "needs review"})`)
		.join("\n");
}

function uniqueValues<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function percent(part: number, total: number): number {
	if (!total) return 0;
	return Math.round((part / total) * 100);
}

function pass(category: string, title: string, detail: string, dimension: Dimension, sop_ref?: string): Finding {
	return {
		severity: "pass",
		category,
		title,
		problem: detail,
		fix: "",
		sop_ref,
		dimension,
	};
}

function sortFindings(findings: Finding[]): Finding[] {
	return [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function computeDimensionScores(findings: Finding[]): Record<Dimension, number> {
	const scores = {} as Record<Dimension, number>;
	for (const dim of Object.keys(DIMENSION_WEIGHTS) as Dimension[]) {
		const penalty = findings
			.filter(finding => finding.dimension === dim && finding.severity !== "pass")
			.reduce((sum, finding) => sum + SEVERITY_PENALTY[finding.severity], 0);
		scores[dim] = Math.max(0, Math.min(100, 100 - penalty));
	}
	return scores;
}

function computeCompositeScore(dimensions: Record<Dimension, number>): number {
	return Math.round(
		(Object.entries(DIMENSION_WEIGHTS) as [Dimension, number][]).reduce(
			(sum, [dimension, weight]) => sum + dimensions[dimension] * weight,
			0,
		),
	);
}

function buildEmptyStats(httpsOk: boolean, responseMs: number): AuditResult["stats"] {
	return {
		httpsOk,
		responseMs,
		wordCount: 0,
		schemaTypes: [],
		hasLlmsTxt: false,
		blockedCrawlers: [],
		tableCount: 0,
		hasCanonical: false,
		hasLang: false,
		hasViewport: false,
		hasOpenGraph: false,
		hasSitemap: false,
		h1Count: 0,
		h2Count: 0,
		h3Count: 0,
		questionHeadings: 0,
		hasFaqSchema: false,
		listCount: 0,
		imageCount: 0,
		imagesWithoutAlt: 0,
		hasVideoEmbed: false,
		internalLinks: 0,
		externalLinks: 0,
		qualityExternalLinks: 0,
		hasAuthorSignal: false,
		hasDateSignal: false,
		optimalParagraphs: 0,
		longParagraphs: 0,
		hasAboutPage: false,
		hasContactPage: false,
		lastModified: null,
		crawledPages: 0,
		discoveredUrls: 0,
		checkedFiles: [],
		failedPages: 0,
		averageWordsPerPage: 0,
		thinPages: 0,
		clientRenderedPages: 0,
		duplicateTitleCount: 0,
		pagesWithoutCanonical: 0,
		pagesWithoutSchema: 0,
		pagesWithoutAuthor: 0,
		pagesWithoutDate: 0,
		pagesWithoutQuestionHeadings: 0,
		pagesWithFaq: 0,
		pagesWithTables: 0,
		pagesWithVideo: 0,
		pagesWithQualityCitations: 0,
		pdfCount: 0,
		documentCount: 0,
		imageFileCount: 0,
		crawledPageSummaries: [],
	};
}

function addSiteFindings(params: {
	findings: Finding[];
	pages: PageAnalysis[];
	resources: ResourceStatus[];
	robotsTxt: string;
	blockedCrawlers: string[];
	hasSitemap: boolean;
	hasLlmsTxt: boolean;
	llmsTxtContent: string;
	baseUrl: URL;
	discoveredUrls: number;
}) {
	const {
		findings,
		pages,
		resources,
		robotsTxt,
		blockedCrawlers,
		hasSitemap,
		hasLlmsTxt,
		llmsTxtContent,
		baseUrl,
		discoveredUrls,
	} = params;
	const okPages = pages.filter(page => page.ok);
	const pageCount = okPages.length;
	const currentYear = new Date().getFullYear();

	findings.push(
		baseUrl.protocol === "https:"
			? pass("security", "HTTPS enabled", "The audited site is served over HTTPS.", "technical", "Part 4.5")
			: {
					severity: "critical",
					category: "security",
					title: "Site is not served over HTTPS",
					problem: "AI search systems and users both treat insecure pages as lower-trust sources.",
					fix: "Install TLS, redirect HTTP to HTTPS, and update canonical URLs, sitemaps, and internal links to the HTTPS version.",
					sop_ref: "Part 4.5",
					dimension: "technical",
				},
	);

	if (blockedCrawlers.length) {
		findings.push({
			severity: "critical",
			category: "crawler_access",
			title: "AI retrieval crawlers are blocked",
			problem: `robots.txt blocks: ${blockedCrawlers.join(", ")}. Blocked retrieval bots cannot cite your pages.`,
			fix: "Update robots.txt and CDN bot rules to allow OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Claude-SearchBot, and Googlebot for public content you want cited.",
			evidence: robotsTxt.slice(0, 900),
			sop_ref: "Part 4.2",
			dimension: "technical",
		});
	} else if (!robotsTxt) {
		findings.push({
			severity: "low",
			category: "crawler_access",
			title: "No robots.txt found",
			problem:
				"Crawlers default to allowed, but there is no explicit crawl policy, sitemap pointer, or AI access record.",
			fix: "Publish /robots.txt with explicit Allow rules for retrieval bots, Disallow rules for private areas, and a Sitemap directive.",
			sop_ref: "Part 4.2",
			dimension: "technical",
		});
	} else {
		findings.push(
			pass(
				"crawler_access",
				"AI retrieval crawlers are allowed",
				"robots.txt does not block the major AI retrieval crawlers checked.",
				"technical",
				"Part 4.2",
			),
		);
	}

	if (!hasSitemap) {
		findings.push({
			severity: "high",
			category: "sitemap",
			title: "No usable sitemap found",
			problem:
				"The crawler could not find a working sitemap in robots.txt, /sitemap.xml, or /sitemap_index.xml. This limits complete site discovery.",
			fix: "Generate an XML sitemap with all indexable canonical pages, submit it in Google Search Console/Bing Webmaster Tools, and reference it in robots.txt.",
			sop_ref: "Part 4.6",
			dimension: "technical",
		});
	} else {
		findings.push(
			pass(
				"sitemap",
				"Sitemap discovery works",
				`${discoveredUrls} URL(s) were discovered from sitemap and internal links.`,
				"technical",
				"Part 4.6",
			),
		);
	}

	if (!hasLlmsTxt) {
		findings.push({
			severity: "medium",
			category: "llms_txt",
			title: "Missing llms.txt",
			problem:
				"No /llms.txt file was found. AI crawlers do not have a curated map of the site's most important pages.",
			fix: "Publish /llms.txt with a short site description, key page links, factual descriptions, and contact/authority notes. Keep it aligned with the sitemap.",
			sop_ref: "Part 4.3",
			dimension: "technical",
		});
	} else {
		const llmsLinks = (llmsTxtContent.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
		if (llmsLinks < Math.min(8, Math.max(3, Math.floor(pageCount / 2)))) {
			findings.push({
				severity: "medium",
				category: "llms_txt",
				title: "llms.txt exists but is too thin",
				problem: `/llms.txt only exposes ${llmsLinks} Markdown link(s). It should point AI systems to the pages that best answer user questions.`,
				fix: "Add the main service/product pages, best guides, comparisons, FAQs, research pages, and policy/contact pages with one-sentence descriptions.",
				evidence: llmsTxtContent.slice(0, 900),
				sop_ref: "Part 4.3",
				dimension: "technical",
			});
		} else {
			findings.push(
				pass(
					"llms_txt",
					"llms.txt is present",
					`/llms.txt includes ${llmsLinks} linked page(s).`,
					"technical",
					"Part 4.3",
				),
			);
		}
	}

	const failedPages = pages.filter(page => !page.ok).length;
	if (failedPages) {
		findings.push({
			severity: failedPages > 3 ? "high" : "medium",
			category: "crawl_errors",
			title: `${failedPages} discovered page(s) failed to load`,
			problem: "Some internal URLs returned errors or non-HTML responses during crawling.",
			fix: "Fix broken internal links, redirects, and server errors. Keep only indexable HTML pages in your sitemap.",
			evidence: pageList(pages, page => !page.ok),
			sop_ref: "Part 4.5",
			dimension: "technical",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"crawl_errors",
				"All crawled pages loaded",
				`${pageCount} page(s) returned usable HTML.`,
				"technical",
				"Part 4.5",
			),
		);
	}

	const clientRenderedPages = okPages.filter(page => page.hasClientRenderRisk);
	if (clientRenderedPages.length) {
		findings.push({
			severity: "critical",
			category: "server_rendering",
			title: `${clientRenderedPages.length} page(s) may be client-rendered shells`,
			problem:
				"AI crawlers often do not execute JavaScript. Pages with little server-rendered text can be invisible to AI retrieval systems.",
			fix: "Render primary content in HTML on the server. For Next.js, avoid hiding key copy behind client-only components and verify with View Source.",
			evidence: pageList(clientRenderedPages, () => true),
			sop_ref: "Part 4.5",
			dimension: "technical",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"server_rendering",
				"Primary content appears server-rendered",
				"No crawled page looked like an empty JavaScript shell.",
				"technical",
				"Part 4.5",
			),
		);
	}

	const pagesWithoutCanonical = okPages.filter(page => !page.canonical);
	if (percent(pagesWithoutCanonical.length, pageCount) > 30) {
		findings.push({
			severity: "medium",
			category: "canonical",
			title: `${pagesWithoutCanonical.length}/${pageCount} pages lack canonical tags`,
			problem:
				"Missing canonical URLs make it harder for search and AI systems to consolidate duplicate or parameterized content.",
			fix: "Add a self-referencing canonical tag to every indexable page and use only canonical URLs in sitemap and llms.txt.",
			evidence: pageList(pagesWithoutCanonical, () => true),
			sop_ref: "Part 4.6",
			dimension: "technical",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"canonical",
				"Canonical coverage is healthy",
				"Most crawled pages declare canonical URLs.",
				"technical",
				"Part 4.6",
			),
		);
	}

	const pagesWithoutSchema = okPages.filter(page => page.schemaTypes.length === 0);
	if (percent(pagesWithoutSchema.length, pageCount) > 50) {
		findings.push({
			severity: "high",
			category: "schema",
			title: `${pagesWithoutSchema.length}/${pageCount} pages have no JSON-LD schema`,
			problem:
				"AI systems use structured data to identify entities, authors, dates, products, FAQs, and organization relationships.",
			fix: "Add Organization/WebSite schema globally, Article or BlogPosting schema on articles, Product/Service schema on commercial pages, FAQPage where Q&A is visible, and sameAs links for entity identity.",
			evidence: pageList(pagesWithoutSchema, () => true),
			sop_ref: "Part 4.4",
			dimension: "technical",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"schema",
				"Structured data coverage is healthy",
				"Most crawled pages include JSON-LD schema.",
				"technical",
				"Part 4.4",
			),
		);
	}

	const thinPages = okPages.filter(page => page.wordCount >= 100 && page.wordCount < 600);
	if (percent(thinPages.length, pageCount) > 35) {
		findings.push({
			severity: "high",
			category: "content_depth",
			title: `${thinPages.length}/${pageCount} pages are thin`,
			problem:
				"Pages under 600 words usually lack enough self-contained answers, evidence, and context to be cited by AI systems.",
			fix: "Expand important pages to answer the main query, related questions, objections, examples, statistics, and next steps. Merge or noindex thin utility pages.",
			evidence: pageList(thinPages, () => true),
			sop_ref: "Part 3.1",
			dimension: "citability",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"content_depth",
				"Content depth is acceptable across the crawl",
				"Thin pages are not dominant in the crawled set.",
				"citability",
				"Part 3.1",
			),
		);
	}

	const noOptimalPassages = okPages.filter(page => page.wordCount > 600 && page.optimalParagraphs === 0);
	if (percent(noOptimalPassages.length, pageCount) > 40) {
		findings.push({
			severity: "high",
			category: "passage_length",
			title: "Few citation-ready answer passages",
			problem: `${noOptimalPassages.length} substantial page(s) lack 134-167 word self-contained passages, the target range for clean AI citation blocks.`,
			fix: "Add answer blocks under question headings. Each should define the topic, answer the query directly, include one concrete fact, and stand alone without surrounding context.",
			evidence: pageList(noOptimalPassages, () => true),
			sop_ref: "Part 3.3",
			dimension: "citability",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"passage_length",
				"Citation-ready passages detected",
				"The site has pages with extractable answer-length passages.",
				"citability",
				"Part 3.3",
			),
		);
	}

	const lowStatsPages = okPages.filter(page => page.wordCount > 600 && page.statMatches < 3);
	if (percent(lowStatsPages.length, pageCount) > 40) {
		findings.push({
			severity: "high",
			category: "factual_density",
			title: "Low factual density on major pages",
			problem: `${lowStatsPages.length} substantial page(s) contain fewer than three numeric facts or statistics. Vague copy is less citable.`,
			fix: "Add specific data points, dates, percentages, benchmarks, prices, counts, or original observations. Link factual claims to credible sources.",
			evidence: pageList(lowStatsPages, () => true),
			sop_ref: "Part 3.1",
			dimension: "citability",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"factual_density",
				"Factual density is usable",
				"Most substantial pages include specific facts or numbers.",
				"citability",
				"Part 3.1",
			),
		);
	}

	const noCitationsPages = okPages.filter(page => page.wordCount > 600 && page.qualityExternalLinks === 0);
	if (percent(noCitationsPages.length, pageCount) > 50) {
		findings.push({
			severity: "medium",
			category: "citations",
			title: "Important pages lack authoritative outbound citations",
			problem: `${noCitationsPages.length} substantial page(s) do not cite .gov, .edu, .org, or similar authority sources.`,
			fix: "Add inline citations to primary sources: official docs, research papers, standards bodies, government data, industry reports, and trusted non-profits.",
			evidence: pageList(noCitationsPages, () => true),
			sop_ref: "Part 3.1",
			dimension: "citability",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"citations",
				"Authoritative citations exist",
				"A useful share of crawled content links to high-authority external sources.",
				"citability",
				"Part 3.1",
			),
		);
	}

	const pagesWithoutQuestionHeadings = okPages.filter(
		page => page.h2Texts.length + page.h3Texts.length > 0 && page.questionHeadings === 0,
	);
	if (percent(pagesWithoutQuestionHeadings.length, pageCount) > 45) {
		findings.push({
			severity: "high",
			category: "question_headings",
			title: "Pages are not structured around user questions",
			problem: `${pagesWithoutQuestionHeadings.length} page(s) have headings, but none are phrased as questions. AI search is strongly query-shaped.`,
			fix: "Rewrite 30-50% of H2/H3 headings as natural questions and answer each immediately in the first 40-60 words below the heading.",
			evidence: pageList(pagesWithoutQuestionHeadings, () => true),
			sop_ref: "Part 3.3",
			dimension: "citability",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"question_headings",
				"Question heading coverage is healthy",
				"Question-based headings appear across the crawl.",
				"citability",
				"Part 3.3",
			),
		);
	}

	const pagesWithFaq = okPages.filter(page => page.hasFaqStructure);
	if (pagesWithFaq.length === 0) {
		findings.push({
			severity: "medium",
			category: "faq_structure",
			title: "No FAQ or Q&A structure found anywhere",
			problem: "The crawl did not find FAQPage schema, details blocks, or visible FAQ/Q&A sections.",
			fix: "Add FAQ sections to core service, product, comparison, and educational pages. Use visible Q&A content and matching FAQPage schema where appropriate.",
			sop_ref: "Part 3.3",
			dimension: "citability",
		});
	} else {
		findings.push(
			pass(
				"faq_structure",
				`FAQ/Q&A found on ${pagesWithFaq.length} page(s)`,
				"The site has extractable Q&A content.",
				"citability",
				"Part 3.3",
			),
		);
	}

	const h1Problems = okPages.filter(page => page.h1Texts.length !== 1);
	if (h1Problems.length) {
		findings.push({
			severity: "medium",
			category: "heading_structure",
			title: `${h1Problems.length} page(s) have H1 problems`,
			problem: "Every indexable page should have one clear H1 that names the page's topic or offer.",
			fix: "Use exactly one H1 per page. Put subsections under H2/H3 headings and keep the H1 aligned with the title and canonical topic.",
			evidence: pageList(h1Problems, () => true),
			sop_ref: "Part 4.6",
			dimension: "structural",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"heading_structure",
				"H1 structure is clean",
				"Every crawled page has exactly one H1.",
				"structural",
				"Part 4.6",
			),
		);
	}

	const pagesWithoutH2 = okPages.filter(page => page.wordCount > 300 && page.h2Texts.length === 0);
	if (pagesWithoutH2.length) {
		findings.push({
			severity: "high",
			category: "section_structure",
			title: `${pagesWithoutH2.length} content page(s) lack H2 sections`,
			problem:
				"AI retrieval chunks content by headings. Long pages without sections are harder to extract accurately.",
			fix: "Add descriptive H2 sections every 200-400 words. Use H3 headings for subtopics under longer sections.",
			evidence: pageList(pagesWithoutH2, () => true),
			sop_ref: "Part 4.6",
			dimension: "structural",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"section_structure",
				"H2 sectioning is healthy",
				"Substantial pages are broken into sections.",
				"structural",
				"Part 4.6",
			),
		);
	}

	const pagesWithoutLists = okPages.filter(page => page.wordCount > 500 && page.listCount === 0);
	if (percent(pagesWithoutLists.length, pageCount) > 40) {
		findings.push({
			severity: "medium",
			category: "list_structure",
			title: "Many pages lack list structures",
			problem: `${pagesWithoutLists.length} substantial page(s) have no bullet or numbered lists. Lists create extractable information units.`,
			fix: "Convert steps, features, benefits, criteria, examples, and requirements into ordered or unordered lists.",
			evidence: pageList(pagesWithoutLists, () => true),
			sop_ref: "Part 4.6",
			dimension: "structural",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"list_structure",
				"List structures are present",
				"A useful share of substantial pages use lists.",
				"structural",
				"Part 4.6",
			),
		);
	}

	const hasAboutPage = okPages.some(page => /\/about(\/|$)/i.test(new URL(page.finalUrl).pathname));
	const hasContactPage = okPages.some(page => /\/contact(\/|$)/i.test(new URL(page.finalUrl).pathname));
	const aboutOrContactLinks = okPages.some(page =>
		page.links.some(link => /\/(about|contact)(\/|$)/i.test(new URL(link.url).pathname)),
	);
	if (!hasAboutPage && !hasContactPage && !aboutOrContactLinks) {
		findings.push({
			severity: "low",
			category: "trust_signals",
			title: "No About or Contact page discovered",
			problem:
				"The crawl did not find accessible About or Contact pages. Entity trust is weaker without real organization context.",
			fix: "Create accessible About and Contact pages. Include organization details, people, credentials, location/service area, and links to verified profiles.",
			sop_ref: "Part 6",
			dimension: "authority",
		});
	} else {
		findings.push(
			pass(
				"trust_signals",
				"Trust pages are discoverable",
				"About/Contact signals were discovered through pages or links.",
				"authority",
				"Part 6",
			),
		);
	}

	const pagesWithoutAuthor = okPages.filter(page => page.wordCount > 600 && !page.hasAuthorSignal);
	if (percent(pagesWithoutAuthor.length, pageCount) > 40) {
		findings.push({
			severity: "high",
			category: "author_signal",
			title: "Major pages lack author or reviewer attribution",
			problem: `${pagesWithoutAuthor.length} substantial page(s) have no detectable byline, reviewer, Person schema, or author markup.`,
			fix: "Add visible bylines or expert reviewers, link to author profiles, include credentials, and add Person/Article schema.",
			evidence: pageList(pagesWithoutAuthor, () => true),
			sop_ref: "Part 6",
			dimension: "authority",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"author_signal",
				"Author signals are present",
				"Most substantial pages expose authorship or reviewer context.",
				"authority",
				"Part 6",
			),
		);
	}

	const pagesWithoutDate = okPages.filter(page => page.wordCount > 600 && !page.hasDateSignal);
	if (percent(pagesWithoutDate.length, pageCount) > 40) {
		findings.push({
			severity: "high",
			category: "date_signal",
			title: "Major pages lack publication or update dates",
			problem: `${pagesWithoutDate.length} substantial page(s) do not expose visible dates or date schema.`,
			fix: "Add visible Published and Updated dates, plus datePublished/dateModified in Article or BlogPosting schema.",
			evidence: pageList(pagesWithoutDate, () => true),
			sop_ref: "Part 6",
			dimension: "authority",
		});
	} else if (pageCount) {
		findings.push(
			pass(
				"date_signal",
				"Freshness signals are present",
				"Most substantial pages expose date information.",
				"authority",
				"Part 6",
			),
		);
	}

	const noYearSignal = okPages.filter(page => {
		const h1 = page.h1Texts.join(" ");
		return page.wordCount > 600 && !page.title.includes(String(currentYear)) && !h1.includes(String(currentYear));
	});
	if (percent(noYearSignal.length, pageCount) > 70) {
		findings.push({
			severity: "low",
			category: "freshness",
			title: `Few pages include a ${currentYear} freshness signal`,
			problem:
				"Where topics change over time, current-year signals help AI systems and users trust that content is maintained.",
			fix: `For freshness-sensitive guides, add ${currentYear} to the title, H1, or an early updated note only after actually refreshing the content.`,
			evidence: pageList(noYearSignal, () => true),
			sop_ref: "Part 3.3",
			dimension: "authority",
		});
	}

	const pagesWithImageAltProblems = okPages.filter(page => page.imagesWithoutAlt > 0);
	if (pagesWithImageAltProblems.length) {
		findings.push({
			severity: percent(pagesWithImageAltProblems.length, pageCount) > 40 ? "medium" : "low",
			category: "images",
			title: `${pagesWithImageAltProblems.length} page(s) have images missing alt text`,
			problem: "Images without alt text are weak signals for AI systems and create accessibility issues.",
			fix: "Add descriptive alt text to informative images. For charts, summarize the key data point. For decorative images, use empty alt text.",
			evidence: pageList(pagesWithImageAltProblems, () => true),
			sop_ref: "Part 4",
			dimension: "multimodal",
		});
	} else if (okPages.some(page => page.imageCount > 0)) {
		findings.push(
			pass(
				"images",
				"Image alt coverage is clean",
				"No crawled page had missing image alt text.",
				"multimodal",
				"Part 4",
			),
		);
	} else {
		findings.push({
			severity: "low",
			category: "images",
			title: "No images found on crawled pages",
			problem:
				"The crawl did not find image content. Visuals, charts, and screenshots can support multi-modal AI understanding.",
			fix: "Add relevant original images, diagrams, or screenshots to important pages and describe them with alt text.",
			sop_ref: "Part 4",
			dimension: "multimodal",
		});
	}

	const pagesWithTables = okPages.filter(page => page.tableCount > 0);
	if (pagesWithTables.length === 0) {
		findings.push({
			severity: "low",
			category: "comparison_table",
			title: "No data or comparison tables found",
			problem: "Tables give AI systems pre-structured data for comparisons, criteria, prices, specs, and summaries.",
			fix: "Add tables to pages that compare tools, services, plans, process steps, features, requirements, or research findings.",
			sop_ref: "Part 3.3",
			dimension: "citability",
		});
	} else {
		findings.push(
			pass(
				"comparison_table",
				`Tables found on ${pagesWithTables.length} page(s)`,
				"Structured tables are available for extraction.",
				"citability",
				"Part 3.3",
			),
		);
	}

	const pagesWithVideo = okPages.filter(page => page.hasVideoEmbed);
	if (pagesWithVideo.length === 0 && okPages.some(page => page.wordCount > 800)) {
		findings.push({
			severity: "low",
			category: "video",
			title: "No embedded video found",
			problem: "Video and YouTube presence can strengthen entity and brand signals for AI search visibility.",
			fix: "Create companion videos for core guides or product pages and embed them with VideoObject schema and transcripts.",
			sop_ref: "Part 7",
			dimension: "multimodal",
		});
	} else if (pagesWithVideo.length) {
		findings.push(
			pass(
				"video",
				`Video found on ${pagesWithVideo.length} page(s)`,
				"Multi-modal content is present.",
				"multimodal",
				"Part 7",
			),
		);
	}

	const checkedTrainingPolicy = TRAINING_CRAWLERS.filter(bot =>
		robotsTxt ? !isPathAllowed(parseRobotsGroups(robotsTxt), `${baseUrl.origin}/`, bot) : false,
	);
	if (robotsTxt && checkedTrainingPolicy.length === 0) {
		findings.push({
			severity: "low",
			category: "ai_policy",
			title: "Training crawler policy is not explicit",
			problem: "robots.txt does not clearly separate AI retrieval bots from training/data crawlers.",
			fix: "Decide your policy: allow retrieval bots needed for citation, and separately allow or block training crawlers such as CCBot, anthropic-ai, Bytespider, and cohere-ai.",
			sop_ref: "Part 4.2",
			dimension: "technical",
		});
	}

	const fileLinks = uniqueValues(okPages.flatMap(page => page.fileLinks.map(link => link.url)));
	const importantRootFiles = resources.filter(resource => resource.ok).map(resource => resource.path);
	if (fileLinks.length || importantRootFiles.length) {
		findings.push(
			pass(
				"files",
				"Site files and rules were checked",
				`Checked root files: ${importantRootFiles.join(", ") || "none found"}. Found ${fileLinks.length} linked file asset(s).`,
				"technical",
				"Part 4.6",
			),
		);
	}
}

const MAX_STORED_HTML = 300_000;
const MAX_STORED_TEXT = 60_000;

/** Convert a parsed page into a persistable record with rule-based verdicts. */
function buildPageRecord(page: PageAnalysis): AuditPageRecord {
	const working: string[] = [];
	const notWorking: string[] = [];
	const w = page.wordCount;

	// Structural
	if (page.h1Texts.length === 1) working.push("Exactly one clear H1");
	else if (page.h1Texts.length === 0) notWorking.push("Missing an H1 heading");
	else notWorking.push(`Multiple H1 headings (${page.h1Texts.length})`);

	if (page.questionHeadings > 0) working.push(`${page.questionHeadings} question-style heading(s)`);
	else if (page.h2Texts.length + page.h3Texts.length > 0)
		notWorking.push("No question-style headings (helps prompt fan-out)");

	if (page.canonical) working.push("Canonical URL present");
	else notWorking.push("No canonical URL");

	// Citability
	if (page.statMatches >= 3) working.push(`${page.statMatches} statistics / data points`);
	else notWorking.push("Low statistical density (add concrete numbers)");

	if (page.qualityExternalLinks > 0) working.push(`${page.qualityExternalLinks} citation(s) to authoritative sources`);
	else notWorking.push("No outbound citations to credible sources");

	if (page.tableCount > 0) working.push(`${page.tableCount} data/comparison table(s)`);
	else notWorking.push("No comparison/data table");

	if (w >= 600) working.push(`Substantial content (${w} words)`);
	else if (w < 300) notWorking.push(`Thin content (${w} words)`);

	// Authority / E-E-A-T
	if (page.hasAuthorSignal) working.push("Author / authorship signal present");
	else if (w > 600) notWorking.push("No author / E-E-A-T signal");
	if (page.hasDateSignal) working.push("Date / freshness signal present");
	else if (w > 600) notWorking.push("No visible date / freshness signal");

	// Schema / technical
	if (page.schemaTypes.length) working.push(`Structured data: ${page.schemaTypes.join(", ")}`);
	else notWorking.push("No structured data (JSON-LD)");
	if (page.hasFaqSchema || page.hasFaqStructure) working.push("FAQ structure present");
	if (page.metaDescription) working.push("Meta description present");
	else notWorking.push("Missing meta description");
	if (page.hasOpenGraph) working.push("Open Graph tags present");
	else notWorking.push("No Open Graph tags");
	if (page.hasClientRenderRisk) notWorking.push("Content may depend on client-side JS (SSR risk)");

	// Multi-modal
	if (page.imageCount > 0 && page.imagesWithoutAlt === 0) working.push("All images have alt text");
	else if (page.imagesWithoutAlt > 0) notWorking.push(`${page.imagesWithoutAlt} image(s) missing alt text`);
	if (page.hasVideoEmbed) working.push("Video embed present");

	if (page.longParagraphs > 0) notWorking.push(`${page.longParagraphs} long paragraph(s) hurt chunk extraction`);

	return {
		url: page.finalUrl,
		requestedUrl: page.url,
		status: page.status,
		ok: page.ok,
		title: page.title,
		metaDescription: page.metaDescription,
		wordCount: w,
		htmlBytes: page.html.length,
		html: page.html.slice(0, MAX_STORED_HTML),
		text: page.text.slice(0, MAX_STORED_TEXT),
		signals: {
			h1: page.h1Texts,
			h2: page.h2Texts,
			h3: page.h3Texts,
			schemaTypes: page.schemaTypes,
			canonical: page.canonical,
			metaDescription: page.metaDescription,
			imageCount: page.imageCount,
			imagesWithoutAlt: page.imagesWithoutAlt,
			tableCount: page.tableCount,
			listCount: page.listCount,
			internalLinks: page.internalLinks,
			externalLinks: page.externalLinks,
			qualityExternalLinks: page.qualityExternalLinks,
			questionHeadings: page.questionHeadings,
			statMatches: page.statMatches,
			hasFaq: page.hasFaqSchema || page.hasFaqStructure,
			hasVideo: page.hasVideoEmbed,
			hasAuthorSignal: page.hasAuthorSignal,
			hasDateSignal: page.hasDateSignal,
			hasOpenGraph: page.hasOpenGraph,
			hasViewport: page.hasViewport,
			hasLang: page.hasLang,
			hasClientRenderRisk: page.hasClientRenderRisk,
		},
		ruleIssues: page.issues,
		working,
		notWorking,
	};
}

export async function runAudit(rawUrl: string): Promise<AuditResult> {
	const baseUrl = normaliseUrl(rawUrl);
	const origin = baseUrl.origin;
	const originHost = baseUrl.host;
	const start = Date.now();
	const findings: Finding[] = [];

	const [robots, llms, aiTxt, securityTxt] = await Promise.all([
		fetchResource(origin, "/robots.txt"),
		fetchResource(origin, "/llms.txt"),
		fetchResource(origin, "/ai.txt"),
		fetchResource(origin, "/.well-known/security.txt"),
	]);

	const robotsTxt = robots.ok ? robots.content : "";
	const robotsGroups = parseRobotsGroups(robotsTxt);
	const blockedCrawlers = parseBlockedCrawlers(robotsTxt);
	const sitemapDiscovery = await discoverSitemapPages(origin, originHost, robotsTxt);

	const queue = new Set<string>();
	const homeUrl = canonicalizeUrl(baseUrl) ?? baseUrl.toString();
	queue.add(homeUrl);
	for (const url of sitemapDiscovery.urls.slice(0, MAX_CRAWL_PAGES)) queue.add(url);

	const pages: PageAnalysis[] = [];
	const seen = new Set<string>();

	while (queue.size && pages.length < MAX_CRAWL_PAGES) {
		const next = [...queue].find(url => !seen.has(url));
		if (!next) break;
		queue.delete(next);
		seen.add(next);

		if (!isLikelyPageUrl(next, originHost)) continue;
		if (robotsTxt && !isPathAllowed(robotsGroups, next, "FirstRankerGEOBot")) continue;

		const page = await analysePage(next, originHost);
		pages.push(page);

		if (page.ok) {
			for (const link of page.links) {
				if (pages.length + queue.size >= MAX_CRAWL_PAGES + 20) break;
				if (link.kind === "internal" && isLikelyPageUrl(link.url, originHost) && !seen.has(link.url)) {
					queue.add(link.url);
				}
			}
		}
	}

	if (!pages.length) {
		if (blockedCrawlers.length) {
			findings.push({
				severity: "critical",
				category: "crawler_access",
				title: "robots.txt blocks AI retrieval crawlers",
				problem: `robots.txt blocks: ${blockedCrawlers.join(", ")}. The audit could not crawl indexable pages under the current robots policy.`,
				fix: "Allow retrieval bots for public content you want cited, and make sure your own crawl/audit user agents can fetch the pages listed in sitemap and llms.txt.",
				evidence: robotsTxt.slice(0, 900),
				sop_ref: "Part 4.2",
				dimension: "technical",
			});
		}
		findings.push({
			severity: "critical",
			category: "availability",
			title: "No pages could be crawled",
			problem: `The audit crawler could not load any HTML pages from ${baseUrl.toString()}.`,
			fix: "Confirm the URL is correct, the site is online, robots.txt permits crawling, and your firewall/CDN does not block standard bot user agents.",
			sop_ref: "Part 4.5",
			dimension: "technical",
		});
		const dimensions = computeDimensionScores(findings);
		return {
			url: baseUrl.toString(),
			fetchedAt: new Date().toISOString(),
			score: 0,
			dimensions,
			findings,
			pages: [],
			stats: {
				...buildEmptyStats(baseUrl.protocol === "https:", Date.now() - start),
				hasLlmsTxt: llms.ok,
				blockedCrawlers,
				hasSitemap: sitemapDiscovery.hasSitemap,
				checkedFiles: [robots, llms, aiTxt, securityTxt]
					.filter(resource => resource.ok)
					.map(resource => resource.path),
				discoveredUrls: sitemapDiscovery.urls.length,
			},
		};
	}

	const resources = [robots, llms, aiTxt, securityTxt];
	addSiteFindings({
		findings,
		pages,
		resources,
		robotsTxt,
		blockedCrawlers,
		hasSitemap: sitemapDiscovery.hasSitemap,
		hasLlmsTxt: llms.ok,
		llmsTxtContent: llms.content,
		baseUrl,
		discoveredUrls: seen.size + queue.size + sitemapDiscovery.urls.length,
	});

	const okPages = pages.filter(page => page.ok);
	const firstOkPage = okPages[0] ?? pages[0];
	const titleCounts = okPages.reduce<Record<string, number>>((acc, page) => {
		const key = page.title.trim().toLowerCase();
		if (key) acc[key] = (acc[key] ?? 0) + 1;
		return acc;
	}, {});
	const duplicateTitleCount = Object.values(titleCounts).filter(count => count > 1).length;

	if (duplicateTitleCount > 0) {
		findings.push({
			severity: "medium",
			category: "duplicate_titles",
			title: `${duplicateTitleCount} duplicate title group(s) found`,
			problem:
				"Duplicate page titles make it harder to distinguish page intent and can weaken entity/topic clarity.",
			fix: "Write unique titles that name the specific page topic, entity, comparison, or offer. Keep title, H1, canonical, and llms.txt descriptions aligned.",
			sop_ref: "Part 4.6",
			dimension: "structural",
		});
	}

	const fileLinks = uniqueValues(okPages.flatMap(page => page.fileLinks.map(link => link.url)));
	const schemaTypes = uniqueValues(okPages.flatMap(page => page.schemaTypes)).sort();
	const wordCount = okPages.reduce((sum, page) => sum + page.wordCount, 0);
	const dimensions = computeDimensionScores(findings);
	const score = computeCompositeScore(dimensions);

	const stats: AuditResult["stats"] = {
		httpsOk: baseUrl.protocol === "https:",
		responseMs: Date.now() - start,
		wordCount,
		schemaTypes,
		hasLlmsTxt: llms.ok,
		blockedCrawlers,
		tableCount: okPages.reduce((sum, page) => sum + page.tableCount, 0),
		hasCanonical: okPages.some(page => !!page.canonical),
		hasLang: okPages.some(page => page.hasLang),
		hasViewport: okPages.some(page => page.hasViewport),
		hasOpenGraph: okPages.some(page => page.hasOpenGraph),
		hasSitemap: sitemapDiscovery.hasSitemap,
		h1Count: okPages.reduce((sum, page) => sum + page.h1Texts.length, 0),
		h2Count: okPages.reduce((sum, page) => sum + page.h2Texts.length, 0),
		h3Count: okPages.reduce((sum, page) => sum + page.h3Texts.length, 0),
		questionHeadings: okPages.reduce((sum, page) => sum + page.questionHeadings, 0),
		hasFaqSchema: okPages.some(page => page.hasFaqSchema),
		listCount: okPages.reduce((sum, page) => sum + page.listCount, 0),
		imageCount: okPages.reduce((sum, page) => sum + page.imageCount, 0),
		imagesWithoutAlt: okPages.reduce((sum, page) => sum + page.imagesWithoutAlt, 0),
		hasVideoEmbed: okPages.some(page => page.hasVideoEmbed),
		internalLinks: okPages.reduce((sum, page) => sum + page.internalLinks, 0),
		externalLinks: okPages.reduce((sum, page) => sum + page.externalLinks, 0),
		qualityExternalLinks: okPages.reduce((sum, page) => sum + page.qualityExternalLinks, 0),
		hasAuthorSignal: okPages.some(page => page.hasAuthorSignal),
		hasDateSignal: okPages.some(page => page.hasDateSignal),
		optimalParagraphs: okPages.reduce((sum, page) => sum + page.optimalParagraphs, 0),
		longParagraphs: okPages.reduce((sum, page) => sum + page.longParagraphs, 0),
		hasAboutPage: okPages.some(page => /\/about(\/|$)/i.test(new URL(page.finalUrl).pathname)),
		hasContactPage: okPages.some(page => /\/contact(\/|$)/i.test(new URL(page.finalUrl).pathname)),
		lastModified: firstOkPage.lastModified,
		crawledPages: okPages.length,
		discoveredUrls: uniqueValues([...seen, ...queue, ...sitemapDiscovery.urls]).length,
		checkedFiles: resources.filter(resource => resource.ok).map(resource => resource.path),
		failedPages: pages.filter(page => !page.ok).length,
		averageWordsPerPage: okPages.length ? Math.round(wordCount / okPages.length) : 0,
		thinPages: okPages.filter(page => page.wordCount >= 100 && page.wordCount < 600).length,
		clientRenderedPages: okPages.filter(page => page.hasClientRenderRisk).length,
		duplicateTitleCount,
		pagesWithoutCanonical: okPages.filter(page => !page.canonical).length,
		pagesWithoutSchema: okPages.filter(page => page.schemaTypes.length === 0).length,
		pagesWithoutAuthor: okPages.filter(page => page.wordCount > 600 && !page.hasAuthorSignal).length,
		pagesWithoutDate: okPages.filter(page => page.wordCount > 600 && !page.hasDateSignal).length,
		pagesWithoutQuestionHeadings: okPages.filter(
			page => page.h2Texts.length + page.h3Texts.length > 0 && page.questionHeadings === 0,
		).length,
		pagesWithFaq: okPages.filter(page => page.hasFaqStructure).length,
		pagesWithTables: okPages.filter(page => page.tableCount > 0).length,
		pagesWithVideo: okPages.filter(page => page.hasVideoEmbed).length,
		pagesWithQualityCitations: okPages.filter(page => page.qualityExternalLinks > 0).length,
		pdfCount: fileLinks.filter(url => /\.pdf(\?|#|$)/i.test(url)).length,
		documentCount: fileLinks.filter(url => /\.(doc|docx|xls|xlsx|ppt|pptx|csv|zip)(\?|#|$)/i.test(url)).length,
		imageFileCount: fileLinks.filter(url => /\.(jpg|jpeg|png|webp|gif|svg)(\?|#|$)/i.test(url)).length,
		crawledPageSummaries: okPages.slice(0, 20).map(page => ({
			url: page.finalUrl,
			title: page.title,
			status: page.status,
			wordCount: page.wordCount,
			h1Count: page.h1Texts.length,
			h2Count: page.h2Texts.length,
			schemaTypes: page.schemaTypes,
			issues: page.issues.slice(0, 5),
		})),
	};

	return {
		url: baseUrl.toString(),
		fetchedAt: new Date().toISOString(),
		score,
		dimensions,
		findings: sortFindings(findings),
		pages: okPages.map(buildPageRecord),
		stats,
	};
}
