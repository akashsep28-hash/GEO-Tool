/**
 * Page Gap Analyzer — SOP scorecard (deterministic, no LLM).
 *
 * This is the SOP registry: every Technical-SEO, On-Page-SEO and GEO action
 * item from the SEO Master SOP becomes a single check that carries its SOP
 * weight and an exact, rule-based algorithm. The same URL + keyword always
 * produces the same scorecard (the hard consistency requirement) because every
 * page-level check is a pure function of the captured page; the only external
 * inputs (PSI field data, robots/sitemap) are read once and, when unavailable,
 * read "unknown" and drop out of the denominator rather than failing.
 *
 * Each check also runs against every ranking competitor (page-level checks
 * only) to report SERP prevalence — turning each failing/partial item into a
 * SERP-grounded gap, in SOP form.
 */
import type { PageFeatures } from "@/lib/page-gap-engine";
import type { SiteSignals } from "@/lib/page-gap-site-signals";
import type { PageSpeedResult } from "@/lib/pagespeed";

export type SopStatus = "pass" | "partial" | "fail" | "unknown" | "not_applicable";
export type SopCategory = "technical" | "on_page" | "geo";
export type SopSource = "Technical SEO" | "On-Page SEO" | "GEO" | "AEO";
export type SopScope = "page" | "page_scoped_site" | "psi" | "process" | "excluded";

export type SopItemResult = {
	id: string;
	sopRow: number;
	sopSource: SopSource;
	category: SopCategory;
	title: string;
	weight: number;
	scope: SopScope;
	status: SopStatus;
	score: number; // 0–1
	detail: string;
	evidence: string[];
	recommendation: string;
	serpPrevalence: { pass: number; total: number } | null;
};

export type SopCategoryScore = {
	category: SopCategory;
	label: string;
	score: number; // 0–100
	scoredWeight: number; // sum of in-scope, known weights
	items: SopItemResult[];
};

export type SopScorecard = {
	overall: number; // 0–100
	scoredWeight: number;
	categories: SopCategoryScore[];
	dataSources: { psi: boolean; psiField: boolean; site: boolean };
};

type EvalOut = {
	status: SopStatus;
	score: number;
	detail: string;
	evidence?: string[];
	recommendation: string;
};

type CheckCtx = {
	page: PageFeatures;
	httpStatus: number;
	keyword: string;
	kwTokens: string[];
	site: SiteSignals | null;
	psi: PageSpeedResult | null;
};

type SopCheck = {
	id: string;
	sopRow: number;
	sopSource: SopSource;
	category: SopCategory;
	title: string;
	weight: number;
	scope: SopScope;
	evaluate: (c: CheckCtx) => EvalOut;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KW_STOP = new Set([
	"a",
	"an",
	"the",
	"for",
	"of",
	"to",
	"in",
	"on",
	"and",
	"or",
	"with",
	"your",
	"my",
	"best",
	"top",
	"near",
	"me",
	"online",
	"app",
	"vs",
	"versus",
	"is",
	"are",
]);

export function kwTokens(keyword: string): string[] {
	return Array.from(
		new Set(
			keyword
				.toLowerCase()
				.split(/[^a-z0-9]+/)
				.filter(t => t.length >= 2 && !KW_STOP.has(t)),
		),
	);
}

function kwRatio(text: string, tokens: string[]): number {
	if (!tokens.length) return 0;
	const lc = text.toLowerCase();
	const hit = tokens.filter(t => lc.includes(t)).length;
	return hit / tokens.length;
}

function kwPresent(text: string, tokens: string[]): boolean {
	return kwRatio(text, tokens) >= 0.6;
}

/** Earliest position (0–1) of any keyword token in the text; 1 = not found. */
function kwFrontPosition(text: string, tokens: string[]): number {
	const lc = text.toLowerCase();
	let best = Infinity;
	for (const t of tokens) {
		const i = lc.indexOf(t);
		if (i >= 0) best = Math.min(best, i);
	}
	if (best === Infinity) return 1;
	return lc.length > 0 ? best / lc.length : 1;
}

function normPath(u: string): string {
	try {
		const url = new URL(u);
		url.hash = "";
		url.search = "";
		let p = url.pathname;
		if (p.length > 1) p = p.replace(/\/+$/, "");
		return `${url.protocol}//${url.host.replace(/^www\./i, "")}${p}`.toLowerCase();
	} catch {
		return u.toLowerCase();
	}
}

const SLUG_STOP = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "is", "are", "your"]);
const CTA_VERB = /\b(get|find|compare|apply|buy|learn|discover|see|start|check|explore|save|book|try)\b/i;
const COMMERCIAL_TYPES = new Set(["product_service", "tool", "category"]);
const ARTICLE_TYPES = new Set(["blog_guide", "news", "comparison"]);

function band(value: number, good: number, ok: number, lowerIsBetter: boolean): EvalOut["status"] {
	if (lowerIsBetter) return value <= good ? "pass" : value <= ok ? "partial" : "fail";
	return value >= good ? "pass" : value >= ok ? "partial" : "fail";
}

function out(
	status: SopStatus,
	score: number,
	detail: string,
	recommendation: string,
	evidence: string[] = [],
): EvalOut {
	return { status, score, detail, recommendation, evidence };
}

// ---------------------------------------------------------------------------
// The SOP registry
// ---------------------------------------------------------------------------

export const SOP_CHECKS: SopCheck[] = [
	// ===================== TECHNICAL SEO (rows 1–12) =====================
	{
		id: "tech.robots_crawlable",
		sopRow: 1,
		sopSource: "Technical SEO",
		category: "technical",
		title: "Crawlable by Google + AI bots (robots.txt / meta robots)",
		weight: 4,
		scope: "page_scoped_site",
		evaluate: ({ page, site }) => {
			if (page.signals.metaRobotsNoindex)
				return out(
					"fail",
					0,
					"Page carries a meta robots `noindex` directive.",
					"Remove the noindex tag so the page can be indexed and cited.",
					["<meta name=robots content=noindex>"],
				);
			if (!site?.robots.fetched)
				return out(
					"unknown",
					0,
					"robots.txt could not be fetched.",
					"Confirm robots.txt allows this path for Googlebot and AI crawlers.",
				);
			if (site.robots.googleAllowed === false)
				return out(
					"fail",
					0,
					"This path is disallowed for Googlebot in robots.txt.",
					"Allow this path for Googlebot in robots.txt.",
				);
			if (site.robots.blockedAiBots.length > 0)
				return out(
					"partial",
					0.6,
					`Allowed for Google but blocked for ${site.robots.blockedAiBots.length} AI bot(s): ${site.robots.blockedAiBots.join(", ")}.`,
					"Allow GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot and Google-Extended so the page can be used by AI answer engines.",
					site.robots.blockedAiBots,
				);
			return out(
				"pass",
				1,
				"This path is crawlable by Googlebot and all major AI bots, and is indexable.",
				"No action needed.",
			);
		},
	},
	{
		id: "tech.in_sitemap",
		sopRow: 2,
		sopSource: "Technical SEO",
		category: "technical",
		title: "Listed in an XML sitemap",
		weight: 3,
		scope: "page_scoped_site",
		evaluate: ({ site }) => {
			if (!site?.sitemap.fetched)
				return out(
					"unknown",
					0,
					"Sitemap could not be checked.",
					"Submit and maintain an accurate XML sitemap that includes this URL.",
				);
			if (!site.sitemap.found)
				return out(
					"fail",
					0,
					"No XML sitemap was found for this domain.",
					"Create and submit an XML sitemap (and reference it in robots.txt).",
				);
			if (site.sitemap.urlListed === true)
				return out(
					"pass",
					1,
					`This URL is listed in the sitemap (scanned ${site.sitemap.urlsScanned} URLs).`,
					"No action needed.",
				);
			if (site.sitemap.urlListed === null)
				return out(
					"unknown",
					0,
					`Sitemap found but the scan was capped at ${site.sitemap.urlsScanned} URLs before confirming this URL.`,
					"Verify this URL is present in the sitemap.",
				);
			return out(
				"partial",
				0.5,
				"A sitemap exists but this URL is not listed in it.",
				"Add this URL to the XML sitemap so it is discovered and re-crawled promptly.",
			);
		},
	},
	{
		id: "tech.canonical_self",
		sopRow: 3,
		sopSource: "Technical SEO",
		category: "technical",
		title: "Self-referencing rel=canonical",
		weight: 3,
		scope: "page",
		evaluate: ({ page }) => {
			if (!page.canonical)
				return out(
					"fail",
					0,
					"No canonical URL is declared.",
					"Add a self-referencing <link rel=canonical> to consolidate ranking signals.",
				);
			const self = normPath(page.url) === normPath(page.canonical);
			if (self) return out("pass", 1, "Canonical is present and self-referencing.", "No action needed.");
			return out(
				"partial",
				0.6,
				`Canonical points elsewhere: ${page.canonical}`,
				"Confirm the canonical target is intentional; otherwise self-reference this URL.",
				[page.canonical],
			);
		},
	},
	{
		id: "tech.status_ok",
		sopRow: 4,
		sopSource: "Technical SEO",
		category: "technical",
		title: "Returns 200 (no 4xx / soft-404)",
		weight: 3,
		scope: "page",
		evaluate: ({ page, httpStatus }) => {
			if (httpStatus >= 400)
				return out(
					"fail",
					0,
					`Page returned HTTP ${httpStatus}.`,
					"Restore the content or 301-redirect this URL to the most relevant live page.",
				);
			const looksNotFound = /\b(404|not found|no longer (exists|available)|page (not found|removed)|sorry)\b/i.test(
				`${page.title} ${page.h1Text}`,
			);
			if (httpStatus !== 0 && httpStatus < 400 && looksNotFound && page.wordCount < 150)
				return out(
					"partial",
					0.4,
					`Returns ${httpStatus} but looks like a soft-404 (thin body, "not found" wording).`,
					"Return a real 404/410 for missing pages, or restore the content.",
				);
			return out(
				"pass",
				1,
				httpStatus ? `Returns HTTP ${httpStatus}.` : "Page loaded successfully.",
				"No action needed.",
			);
		},
	},
	{
		id: "tech.lcp",
		sopRow: 5,
		sopSource: "Technical SEO",
		category: "technical",
		title: "LCP under 2.5s (CrUX field, p75)",
		weight: 2.5,
		scope: "psi",
		evaluate: ({ psi }) => {
			const m = psi?.field.lcpMs;
			if (!m)
				return out(
					"unknown",
					0,
					"No CrUX field data for LCP.",
					"Optimise the largest element: compress the hero image, preload it, and cut server response time.",
				);
			const s = m.p75 / 1000;
			const status = band(s, 2.5, 4, true);
			return out(
				status,
				status === "pass" ? 1 : status === "partial" ? 0.5 : 0,
				`Field LCP p75 ≈ ${s.toFixed(2)}s (${m.category}).`,
				"Target LCP < 2.5s: compress/preload the hero asset, use a CDN, reduce TTFB.",
			);
		},
	},
	{
		id: "tech.inp",
		sopRow: 6,
		sopSource: "Technical SEO",
		category: "technical",
		title: "INP under 200ms (CrUX field, p75)",
		weight: 2.5,
		scope: "psi",
		evaluate: ({ psi }) => {
			const m = psi?.field.inpMs;
			if (!m)
				return out(
					"unknown",
					0,
					"No CrUX field data for INP.",
					"Reduce long JS tasks, break up blocking scripts, and offload heavy work to web workers.",
				);
			const status = band(m.p75, 200, 500, true);
			return out(
				status,
				status === "pass" ? 1 : status === "partial" ? 0.5 : 0,
				`Field INP p75 ≈ ${Math.round(m.p75)}ms (${m.category}).`,
				"Target INP < 200ms: split long tasks, defer non-critical JS, optimise event handlers.",
			);
		},
	},
	{
		id: "tech.cls",
		sopRow: 7,
		sopSource: "Technical SEO",
		category: "technical",
		title: "CLS under 0.1 (CrUX field, p75)",
		weight: 3,
		scope: "psi",
		evaluate: ({ psi }) => {
			const m = psi?.field.cls;
			if (!m)
				return out(
					"unknown",
					0,
					"No CrUX field data for CLS.",
					"Reserve space for media/ads with explicit width/height and use font-display:swap.",
				);
			const status = band(m.p75, 0.1, 0.25, true);
			return out(
				status,
				status === "pass" ? 1 : status === "partial" ? 0.5 : 0,
				`Field CLS p75 ≈ ${m.p75.toFixed(3)} (${m.category}).`,
				"Target CLS < 0.1: set width/height on images/embeds, avoid inserting content above existing elements.",
			);
		},
	},
	{
		id: "tech.assets",
		sopRow: 8,
		sopSource: "Technical SEO",
		category: "technical",
		title: "JS/CSS deferred, minified, compressed, cached",
		weight: 3,
		scope: "psi",
		evaluate: ({ psi }) => {
			const lab = psi?.lab;
			if (!lab)
				return out(
					"unknown",
					0,
					"No Lighthouse data for asset optimisation.",
					"Defer non-critical JS, minify CSS/JS, enable Brotli/gzip and long cache TTLs.",
				);
			const ids = [
				"render-blocking-resources",
				"unminified-css",
				"unminified-javascript",
				"uses-text-compression",
				"uses-long-cache-ttl",
			];
			const scores = ids.map(i => lab.audits[i]?.score).filter((s): s is number => typeof s === "number");
			if (!scores.length)
				return out(
					"unknown",
					0,
					"Asset audits not present in Lighthouse result.",
					"Defer non-critical JS, minify CSS/JS, enable compression and caching.",
				);
			const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
			const failing = ids
				.filter(i => typeof lab.audits[i]?.score === "number" && (lab.audits[i].score as number) < 0.9)
				.map(i => lab.audits[i].title);
			const status = avg >= 0.9 ? "pass" : avg >= 0.5 ? "partial" : "fail";
			return out(
				status,
				avg,
				`Lighthouse asset audits average ${(avg * 100).toFixed(0)}/100.`,
				"Address: defer/blocking JS-CSS, minification, text compression, cache TTLs.",
				failing,
			);
		},
	},
	{
		id: "tech.mobile",
		sopRow: 9,
		sopSource: "Technical SEO",
		category: "technical",
		title: "Mobile responsive (viewport configured)",
		weight: 4,
		scope: "page",
		evaluate: ({ page, psi }) => {
			if (!page.hasViewport)
				return out(
					"fail",
					0,
					"No <meta name=viewport> — the page is not configured for mobile.",
					"Add <meta name=viewport content='width=device-width, initial-scale=1'> and use responsive CSS.",
				);
			const vp = psi?.lab?.audits.viewport?.score;
			if (typeof vp === "number" && vp < 1)
				return out(
					"partial",
					0.6,
					"Viewport present but Lighthouse flags a mobile viewport issue.",
					"Fix the viewport meta tag / tap-target / content-width issues Lighthouse reports.",
				);
			return out(
				"pass",
				1,
				"Viewport is configured for mobile.",
				"No action needed (verify tap-targets in GSC's Mobile Usability report).",
			);
		},
	},
	{
		id: "tech.https",
		sopRow: 10,
		sopSource: "Technical SEO",
		category: "technical",
		title: "HTTPS with no mixed content",
		weight: 1,
		scope: "page",
		evaluate: ({ page, site }) => {
			const isHttps = /^https:/i.test(page.url);
			if (!isHttps)
				return out(
					"fail",
					0,
					"Page is not served over HTTPS.",
					"Install TLS and 301-redirect all HTTP traffic to HTTPS.",
				);
			const { mixedActive, mixedPassive, mixedSamples } = page.signals;
			if (mixedActive > 0)
				return out(
					"fail",
					0.2,
					`${mixedActive} active mixed-content resource(s) loaded over HTTP.`,
					"Serve all scripts/stylesheets/iframes over HTTPS.",
					mixedSamples,
				);
			if (mixedPassive > 0)
				return out(
					"partial",
					0.6,
					`${mixedPassive} passive mixed-content resource(s) (images/media) over HTTP.`,
					"Serve all images/media over HTTPS.",
					mixedSamples,
				);
			const redir = site?.https.httpRedirectsToHttps;
			if (redir === false)
				return out(
					"partial",
					0.7,
					"HTTPS is served but the HTTP version does not redirect to HTTPS.",
					"301-redirect http:// to https://.",
				);
			return out("pass", 1, "Served over HTTPS with no mixed content.", "No action needed.");
		},
	},
	{
		id: "tech.ssr",
		sopRow: 11,
		sopSource: "Technical SEO",
		category: "technical",
		title: "Core content present without JavaScript (SSR/SSG)",
		weight: 3,
		scope: "page_scoped_site",
		evaluate: ({ site }) => {
			if (!site?.ssr.fetched)
				return out(
					"unknown",
					0,
					"Could not fetch the no-JS HTML.",
					"Server-render or statically generate critical content so non-JS AI crawlers can read it.",
				);
			const { ratio, rawHasH1, rawWordCount } = site.ssr;
			if (ratio >= 0.5 && rawHasH1)
				return out(
					"pass",
					1,
					`No-JS HTML carries the content (${rawWordCount} words, ${Math.round(ratio * 100)}% of rendered).`,
					"No action needed.",
				);
			if (ratio >= 0.2)
				return out(
					"partial",
					0.5,
					`No-JS HTML carries only ${Math.round(ratio * 100)}% of rendered content${rawHasH1 ? "" : " and no H1"}.`,
					"Server-render the primary content and H1 so AI bots (which often don't run JS) can read it.",
				);
			return out(
				"fail",
				0.1,
				`Almost no content without JS (${rawWordCount} words, ${Math.round(ratio * 100)}% of rendered).`,
				"Move to SSR/SSG: GPTBot/PerplexityBot frequently do not execute JavaScript, so this page is largely invisible to them.",
			);
		},
	},
	{
		id: "tech.redirects",
		sopRow: 12,
		sopSource: "Technical SEO",
		category: "technical",
		title: "Clean redirects (no chains/loops)",
		weight: 1.5,
		scope: "page_scoped_site",
		evaluate: ({ site }) => {
			if (!site?.redirect.finalStatus)
				return out(
					"unknown",
					0,
					"Redirect path could not be traced.",
					"Collapse multi-step redirects to a single 301.",
				);
			if (site.redirect.loop) return out("fail", 0, "Redirect loop detected.", "Remove the redirect loop entirely.");
			if (site.redirect.hops <= 1)
				return out(
					"pass",
					1,
					site.redirect.hops === 0 ? "No redirect — direct 200." : "Single redirect hop.",
					"No action needed.",
				);
			if (site.redirect.hops === 2)
				return out(
					"partial",
					0.5,
					"2 redirect hops (a short chain).",
					"Collapse the chain to a single 301 to the final URL.",
				);
			return out(
				"fail",
				0.2,
				`${site.redirect.hops}-hop redirect chain.`,
				"Collapse the redirect chain to a single 301 (A→C).",
			);
		},
	},

	// ===================== ON-PAGE SEO (rows 13–25) =====================
	{
		id: "onpage.keyword_clusters",
		sopRow: 13,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Keyword clustering by intent",
		weight: 4,
		scope: "excluded",
		evaluate: () =>
			out(
				"not_applicable",
				0,
				"Site/strategy-level — not derivable from a single page.",
				"Cluster keywords by intent across the site and map clusters to pages.",
			),
	},
	{
		id: "onpage.serp_analysis",
		sopRow: 14,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "SERP analysed before optimising",
		weight: 3,
		scope: "process",
		evaluate: () =>
			out(
				"pass",
				1,
				"Performed by this analysis: the intent verdict and benchmark are derived from the live top-10 SERP.",
				"No action needed — review the intent verdict and benchmark sections.",
			),
	},
	{
		id: "onpage.title",
		sopRow: 15,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Title ≤60 chars with keyword near the front",
		weight: 3,
		scope: "page",
		evaluate: ({ page, kwTokens: kt }) => {
			if (!page.title.trim())
				return out(
					"fail",
					0,
					"Missing <title> tag.",
					"Add a unique title (~50–60 chars) leading with the primary keyword.",
				);
			const len = page.titleLength;
			const hasKw = kwPresent(page.title, kt);
			const pos = kwFrontPosition(page.title, kt);
			const front = pos <= 0.5;
			const lenOk = len >= 20 && len <= 60;
			// ≤60 is the SOP target; 61–65 truncates and can no longer reach "pass".
			let score = len < 20 ? 0.2 : len <= 60 ? 0.4 : len <= 65 ? 0.2 : 0.05;
			score += hasKw ? 0.4 : 0;
			score += hasKw && front ? 0.2 : 0;
			const status: SopStatus = score >= 0.95 ? "pass" : score >= 0.5 ? "partial" : "fail";
			const issues: string[] = [];
			if (!lenOk) issues.push(len > 60 ? `${len} chars — over 60, will truncate` : `${len} chars — very short`);
			if (!hasKw) issues.push("keyword not present");
			else if (!front) issues.push("keyword not in the front half");
			return out(
				status,
				score,
				`"${page.title}" (${len} chars).${issues.length ? ` Issues: ${issues.join("; ")}.` : ""}`,
				"Front-load the primary keyword and keep the title ~50–60 chars.",
				[page.title],
			);
		},
	},
	{
		id: "onpage.meta_description",
		sopRow: 16,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Meta description ≤160 chars with keyword",
		weight: 2,
		scope: "page",
		evaluate: ({ page, kwTokens: kt }) => {
			const md = page.metaDescription.trim();
			if (!md)
				return out(
					"fail",
					0,
					"Missing meta description.",
					"Write a unique 140–160 char description that includes the keyword and a reason to click.",
				);
			const len = md.length;
			const hasKw = kwPresent(md, kt);
			const lenOk = len >= 70 && len <= 160;
			const commercial = COMMERCIAL_TYPES.has(page.pageType);
			const hasCta = !commercial || CTA_VERB.test(md);
			let score = (lenOk ? 0.5 : len <= 175 ? 0.35 : 0.15) + (hasKw ? 0.35 : 0) + (hasCta ? 0.15 : 0);
			score = Math.min(1, score);
			const status: SopStatus = score >= 0.85 ? "pass" : score >= 0.5 ? "partial" : "fail";
			const issues: string[] = [];
			if (!lenOk) issues.push(len > 160 ? `${len} chars — will truncate` : `${len} chars — too short`);
			if (!hasKw) issues.push("keyword not present");
			if (!hasCta) issues.push("no action-oriented wording");
			return out(
				status,
				score,
				`${len} chars.${issues.length ? ` Issues: ${issues.join("; ")}.` : ""}`,
				"Make it unique, ~140–160 chars, with the keyword and a clear reason to click.",
				[md.slice(0, 160)],
			);
		},
	},
	{
		id: "onpage.opening_entity",
		sopRow: 17,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Topic/entity established in the opening paragraph",
		weight: 1.5,
		scope: "page",
		evaluate: ({ page, kwTokens: kt }) => {
			const opening = page.signals.openingText;
			if (!opening)
				return out(
					"fail",
					0,
					"No readable opening paragraph found.",
					"Open with a paragraph that names the topic and primary entity in the first ~100 words.",
				);
			const ratio = kwRatio(opening, kt);
			// Anti-stuffing: a single keyword token repeated excessively in the
			// first ~120 words (not natural head-keyword mentions, which are fine).
			const lc = opening.toLowerCase();
			const maxTokenCount = kt.length ? Math.max(...kt.map(t => lc.split(t).length - 1)) : 0;
			if (ratio < 0.5)
				return out(
					"fail",
					0.2,
					"The primary topic/entity is not clearly established in the opening.",
					"Name the topic and primary entity naturally within the first ~100 words.",
				);
			if (maxTokenCount > 8)
				return out(
					"partial",
					0.6,
					"Topic is present but the opening looks keyword-stuffed.",
					"Mention the entity once naturally — keyword stuffing performs below the no-optimisation baseline (Princeton GEO).",
				);
			return out("pass", 1, "Topic/entity is established naturally in the opening paragraph.", "No action needed.");
		},
	},
	{
		id: "onpage.headings",
		sopRow: 18,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Single H1 + logical H2/H3 hierarchy",
		weight: 2.5,
		scope: "page",
		evaluate: ({ page }) => {
			if (page.h1Count === 0)
				return out("fail", 0, "No H1 on the page.", "Add exactly one H1 naming the page topic.");
			if (page.h1Count > 1)
				return out("partial", 0.5, `${page.h1Count} H1s found.`, "Use exactly one H1; demote the rest to H2/H3.");
			const ordered = page.signals.headingOrderValid;
			const queryLike = page.questionHeadings > 0;
			let score = 0.5; // one H1
			score += ordered ? 0.3 : 0;
			score += queryLike ? 0.2 : 0;
			const status: SopStatus = score >= 0.95 ? "pass" : score >= 0.6 ? "partial" : "fail";
			const issues: string[] = [];
			if (!ordered) issues.push("hierarchy skips levels (H3 before H2)");
			if (!queryLike) issues.push("no question-style subheadings");
			return out(
				status,
				score,
				`One H1; ${page.h2Count} H2 / ${page.h3Count} H3.${issues.length ? ` Issues: ${issues.join("; ")}.` : ""}`,
				"Use a clean H1→H2→H3 hierarchy and phrase subheads as the questions searchers ask.",
			);
		},
	},
	{
		id: "onpage.slug",
		sopRow: 19,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Short, descriptive, keyword-rich URL slug",
		weight: 2,
		scope: "page",
		evaluate: ({ page, kwTokens: kt }) => {
			let path = "/";
			let search = "";
			try {
				const u = new URL(page.url);
				path = u.pathname;
				search = u.search;
			} catch {
				/* ignore */
			}
			if (path === "/" || path === "")
				return out("not_applicable", 0, "Homepage / root URL — slug check does not apply.", "No action needed.");
			const slug = path.replace(/\/+$/, "").split("/").pop() ?? "";
			const decoded = decodeURIComponent(slug).toLowerCase();
			const tokens = decoded.split(/[-_]+/).filter(Boolean);
			const hasKw = kt.some(t => decoded.includes(t));
			const hasDate = /\b(19|20)\d\d\b/.test(decoded) || /\d{4}-\d{2}-\d{2}/.test(path);
			const hasParams = search.length > 0;
			const stopCount = tokens.filter(t => SLUG_STOP.has(t)).length;
			const tooLong = path.length > 75;
			const underscores = decoded.includes("_");
			let score = 1;
			const issues: string[] = [];
			if (!hasKw) {
				score -= 0.4;
				issues.push("no keyword in slug");
			}
			if (hasParams) {
				score -= 0.2;
				issues.push("query parameters present");
			}
			if (hasDate) {
				score -= 0.15;
				issues.push("contains a date");
			}
			if (tooLong) {
				score -= 0.15;
				issues.push(`${path.length} chars — long`);
			}
			if (stopCount >= 2) {
				score -= 0.1;
				issues.push("stop words in slug");
			}
			if (underscores) {
				score -= 0.05;
				issues.push("uses underscores");
			}
			score = Math.max(0, score);
			const status: SopStatus = score >= 0.85 ? "pass" : score >= 0.55 ? "partial" : "fail";
			return out(
				status,
				score,
				`/${slug}${issues.length ? ` — ${issues.join("; ")}` : ""}`,
				"Use a short hyphenated lowercase slug containing the keyword; drop stop words, dates, and parameters.",
				[path],
			);
		},
	},
	{
		id: "onpage.images",
		sopRow: 20,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Images: alt text, descriptive names, modern formats",
		weight: 1.5,
		scope: "page",
		evaluate: ({ page }) => {
			const total = Math.max(page.imageCount, page.signals.imagesParsed);
			if (total === 0) return out("not_applicable", 0, "No images on the page.", "No action needed.");
			const withAlt = page.imageCount > 0 ? 1 - page.imagesWithoutAlt / page.imageCount : 1;
			const descr =
				page.signals.imagesParsed > 0 ? page.signals.imagesDescriptiveName / page.signals.imagesParsed : 0;
			const modern = page.signals.imagesParsed > 0 ? page.signals.imagesModernFormat / page.signals.imagesParsed : 0;
			const score = 0.5 * withAlt + 0.3 * descr + 0.2 * modern;
			const status: SopStatus = score >= 0.8 ? "pass" : score >= 0.5 ? "partial" : "fail";
			const issues: string[] = [];
			if (page.imagesWithoutAlt > 0) issues.push(`${page.imagesWithoutAlt} missing alt`);
			if (descr < 0.5) issues.push("non-descriptive filenames");
			if (modern < 0.5) issues.push("few WebP/AVIF images");
			return out(
				status,
				score,
				`${total} images.${issues.length ? ` Issues: ${issues.join("; ")}.` : ""}`,
				"Add descriptive alt text, name files descriptively, and serve WebP/AVIF.",
			);
		},
	},
	{
		id: "onpage.topic_clusters",
		sopRow: 21,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Topic-cluster architecture",
		weight: 4,
		scope: "excluded",
		evaluate: () =>
			out(
				"not_applicable",
				0,
				"Site-architecture-level — not derivable from a single page (internal-link depth is scored separately).",
				"Build pillar + cluster pages linked bidirectionally across the site.",
			),
	},
	{
		id: "onpage.internal_anchors",
		sopRow: 22,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Descriptive internal anchor text",
		weight: 2.5,
		scope: "page",
		evaluate: ({ page }) => {
			const total = page.signals.totalInternalAnchors;
			if (total === 0)
				return out(
					"fail",
					0,
					"No internal links in the body.",
					"Add 3–8 contextual internal links with descriptive, keyword-rich anchor text.",
				);
			const ratio = page.signals.descriptiveInternalAnchors / total;
			const status: SopStatus = ratio >= 0.7 && total >= 3 ? "pass" : ratio >= 0.4 ? "partial" : "fail";
			const score = Math.min(1, ratio * (total >= 3 ? 1 : 0.7));
			return out(
				status,
				score,
				`${page.signals.descriptiveInternalAnchors}/${total} internal anchors are descriptive.`,
				"Replace 'click here'/'read more' with natural, keyword-bearing anchor text.",
			);
		},
	},
	{
		id: "onpage.comprehensive",
		sopRow: 23,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Comprehensive content that satisfies intent",
		weight: 4,
		scope: "page",
		evaluate: ({ page }) => {
			const depth = Math.min(1, page.wordCount / 1000);
			const media = page.imageCount > 0 || page.hasVideo;
			const data = page.statMatches >= 5;
			const structured = page.listCount > 0 || page.tableCount > 0;
			const faq = page.hasFaq;
			let score = 0.45 * depth + (media ? 0.15 : 0) + (data ? 0.2 : 0) + (structured ? 0.1 : 0) + (faq ? 0.1 : 0);
			score = Math.min(1, score);
			const status: SopStatus = score >= 0.8 ? "pass" : score >= 0.5 ? "partial" : "fail";
			const missing: string[] = [];
			if (page.wordCount < 800) missing.push(`${page.wordCount} words (thin)`);
			if (!media) missing.push("no images/video");
			if (!data) missing.push("few concrete numbers");
			if (!structured) missing.push("no lists/tables");
			return out(
				status,
				score,
				`${page.wordCount} words.${missing.length ? ` Gaps: ${missing.join("; ")}.` : ""}`,
				"Cover the full query fan-out: examples, data, media, and likely follow-up questions — be the last click.",
			);
		},
	},
	{
		id: "onpage.author_trust",
		sopRow: 24,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Author attribution + trust pages (E-E-A-T)",
		weight: 3,
		scope: "page",
		evaluate: ({ page }) => {
			const trust = [page.signals.hasAboutLink, page.signals.hasContactLink, page.signals.hasPrivacyLink].filter(
				Boolean,
			).length;
			const author = page.hasAuthorSignal;
			const editorial = ARTICLE_TYPES.has(page.pageType);
			let score = (editorial ? (author ? 0.6 : 0) : author ? 0.4 : 0.3) + (trust / 3) * (editorial ? 0.4 : 0.6);
			score = Math.min(1, score);
			const status: SopStatus = score >= 0.8 ? "pass" : score >= 0.45 ? "partial" : "fail";
			const issues: string[] = [];
			if (!author && editorial) issues.push("no named author/byline");
			if (trust < 2) issues.push(`${trust}/3 trust-page links (About/Contact/Privacy)`);
			return out(
				status,
				score,
				`Author signal: ${author ? "yes" : "no"}; trust-page links: ${trust}/3.${issues.length ? ` Issues: ${issues.join("; ")}.` : ""}`,
				"Show a named author + bio with credentials, and link About/Contact/Privacy.",
			);
		},
	},
	{
		id: "onpage.freshness",
		sopRow: 25,
		sopSource: "On-Page SEO",
		category: "on_page",
		title: "Freshness (visible updated date)",
		weight: 2.5,
		scope: "page",
		evaluate: ({ page }) => {
			const score = (page.hasDateSignal ? 0.6 : 0) + (page.hasUpdatedYear ? 0.4 : 0);
			const status: SopStatus = score >= 0.9 ? "pass" : score >= 0.5 ? "partial" : "fail";
			return out(
				status,
				score,
				`Date signal: ${page.hasDateSignal ? "yes" : "no"}; current-year signal: ${page.hasUpdatedYear ? "yes" : "no"}.`,
				"Show Published and Updated dates and keep the content current to match the SERP.",
			);
		},
	},

	// ===================== GEO (rows 37–40) =====================
	{
		id: "geo.semantic_html",
		sopRow: 37,
		sopSource: "GEO",
		category: "geo",
		title: "Semantic HTML (tables, definition lists, emphasis)",
		weight: 3,
		scope: "page",
		evaluate: ({ page }) => {
			const hasTable = page.tableCount > 0;
			const hasDl = page.signals.dlCount > 0;
			const hasStrong = page.signals.strongCount >= 3;
			const ordered = page.signals.headingOrderValid;
			const score = (ordered ? 0.4 : 0) + (hasTable ? 0.25 : 0) + (hasStrong ? 0.2 : 0) + (hasDl ? 0.15 : 0);
			const status: SopStatus = score >= 0.75 ? "pass" : score >= 0.4 ? "partial" : "fail";
			const have: string[] = [];
			if (ordered) have.push("clean heading hierarchy");
			if (hasTable) have.push(`${page.tableCount} table(s)`);
			if (hasStrong) have.push("emphasis tags");
			if (hasDl) have.push("definition list(s)");
			return out(
				status,
				score,
				have.length ? `Present: ${have.join(", ")}.` : "Little semantic structure.",
				"Use <table> for comparisons, <dl> for definitions, and <strong> for key terms — these signal entity relationships to LLMs.",
			);
		},
	},
	{
		id: "geo.fact_dense",
		sopRow: 38,
		sopSource: "GEO",
		category: "geo",
		title: "Fact-dense + citable (stats, citations, summaries)",
		weight: 2.5,
		scope: "page",
		evaluate: ({ page }) => {
			const statScore = Math.min(1, page.statMatches / 8);
			const cited = page.qualityExternalLinks > 0 || page.signals.citationCues > 0;
			const summarised = page.signals.summaryCues > 0;
			const score = 0.5 * statScore + (cited ? 0.3 : 0) + (summarised ? 0.2 : 0);
			const status: SopStatus = score >= 0.75 ? "pass" : score >= 0.4 ? "partial" : "fail";
			const issues: string[] = [];
			if (page.statMatches < 5) issues.push(`only ${page.statMatches} concrete numbers`);
			if (!cited) issues.push("no inline citations/sources");
			if (!summarised) issues.push("no summary sentences");
			return out(
				status,
				score,
				`${page.statMatches} stats; citations: ${cited ? "yes" : "no"}; summaries: ${summarised ? "yes" : "no"}.`,
				"Add specific statistics, cite sources inline, and end key sections with a one-line takeaway — the validated GEO citation drivers.",
			);
		},
	},
	{
		id: "geo.entity_consistency",
		sopRow: 39,
		sopSource: "GEO",
		category: "geo",
		title: "Consistent entity naming (brand across page + schema)",
		weight: 2,
		scope: "page",
		evaluate: ({ page }) => {
			const dom = page.domain
				.replace(/\..*$/, "")
				.replace(/[^a-z0-9]/gi, "")
				.toLowerCase();
			const stem = dom.slice(0, Math.min(dom.length, 6));
			const inTitle =
				stem.length >= 3 &&
				page.title
					.toLowerCase()
					.replace(/[^a-z0-9]/g, "")
					.includes(stem);
			const inH1 =
				stem.length >= 3 &&
				page.h1Text
					.toLowerCase()
					.replace(/[^a-z0-9]/g, "")
					.includes(stem);
			const hasOrgSchema = page.schemaTypes.some(s => /^(organization|website|localbusiness|corporation)$/i.test(s));
			const signals = [inTitle, inH1, hasOrgSchema].filter(Boolean).length;
			if (stem.length < 3)
				return out(
					"unknown",
					0,
					"Could not derive a brand entity from the domain.",
					"Refer to your brand by one consistent name across title, H1, and Organization schema.",
				);
			const status: SopStatus = signals >= 2 ? "pass" : signals === 1 ? "partial" : "fail";
			const score = signals >= 2 ? 1 : signals === 1 ? 0.5 : 0;
			return out(
				status,
				score,
				`Brand "${stem}" — in title: ${inTitle}, in H1: ${inH1}, Organization schema: ${hasOrgSchema}.`,
				"Name the brand consistently across the title, H1, and Organization/WebSite schema for Knowledge-Graph + LLM entity recognition.",
			);
		},
	},
	{
		id: "geo.offsite_mentions",
		sopRow: 40,
		sopSource: "GEO",
		category: "geo",
		title: "Off-site brand mentions & citations",
		weight: 3,
		scope: "excluded",
		evaluate: () =>
			out(
				"not_applicable",
				0,
				"Off-page — measured by backlink/mention tooling, not a single page.",
				"Earn editorial mentions on credible, crawlable domains.",
			),
	},

	// ============ GEO/AEO page mechanics (SOP AEO rows 33–36) ============
	{
		id: "aeo.faq",
		sopRow: 33,
		sopSource: "AEO",
		category: "geo",
		title: "FAQ section answering real questions",
		weight: 1.5,
		scope: "page",
		evaluate: ({ page }) => {
			if (!page.hasFaq)
				return out(
					"fail",
					0,
					"No FAQ / Q&A section detected.",
					"Add a 6–8 item FAQ answering the real questions (H3 question + 2–3 sentence answer).",
				);
			return out(
				"pass",
				1,
				"FAQ / Q&A section present.",
				"Keep answers concise (2–3 sentences) and grounded in real questions.",
			);
		},
	},
	{
		id: "aeo.bluf",
		sopRow: 34,
		sopSource: "AEO",
		category: "geo",
		title: "BLUF — direct answer near the top",
		weight: 1.5,
		scope: "page",
		evaluate: ({ page }) => {
			if (page.hasAnswerFirst)
				return out("pass", 1, "Opens with a concise, self-contained answer.", "No action needed.");
			return out(
				"fail",
				0,
				"No concise lead answer (inverse-pyramid) near the top.",
				"Open with a 1–2 sentence direct answer, then elaborate — LLMs lift clean opening sentences.",
			);
		},
	},
	{
		id: "aeo.structured_format",
		sopRow: 35,
		sopSource: "AEO",
		category: "geo",
		title: "Answerable content as lists/steps/tables",
		weight: 1.5,
		scope: "page",
		evaluate: ({ page }) => {
			const lists = page.listCount;
			const tables = page.tableCount;
			if (lists + tables === 0)
				return out(
					"fail",
					0,
					"No lists or tables.",
					"Format steps as numbered lists, comparisons as tables, and features as bullets — the dominant AI-summary formats.",
				);
			const score = Math.min(1, (lists + tables * 2) / 4);
			const status: SopStatus = score >= 0.75 ? "pass" : "partial";
			return out(
				status,
				score,
				`${lists} list(s), ${tables} table(s).`,
				"Add comparison tables and step/feature lists where they fit.",
			);
		},
	},
	{
		id: "aeo.schema",
		sopRow: 36,
		sopSource: "AEO",
		category: "geo",
		title: "Structured data appropriate to the page type",
		weight: 2,
		scope: "page",
		evaluate: ({ page }) => {
			if (page.schemaTypes.length === 0)
				return out(
					"fail",
					0,
					"No JSON-LD structured data.",
					"Add Organization/WebSite plus the page-type schema (Article, Product/Service, Breadcrumb).",
				);
			const lc = page.schemaTypes.map(s => s.toLowerCase());
			const wantArticle = ARTICLE_TYPES.has(page.pageType);
			const wantCommercial = COMMERCIAL_TYPES.has(page.pageType);
			const typeMatch = wantArticle
				? lc.some(s => /(article|blogposting|newsarticle)/.test(s))
				: wantCommercial
					? lc.some(s => /(product|service|offer|financialproduct|loanorcredit)/.test(s))
					: true;
			const hasBreadcrumb = lc.includes("breadcrumblist");
			const hasOrg = lc.some(s => /(organization|website)/.test(s));
			const score = (typeMatch ? 0.5 : 0.2) + (hasOrg ? 0.3 : 0) + (hasBreadcrumb ? 0.2 : 0);
			const status: SopStatus = score >= 0.8 ? "pass" : score >= 0.5 ? "partial" : "fail";
			const missing: string[] = [];
			if (!typeMatch) missing.push(`page-type schema (${wantArticle ? "Article" : "Product/Service"})`);
			if (!hasOrg) missing.push("Organization/WebSite");
			if (!hasBreadcrumb) missing.push("BreadcrumbList");
			return out(
				status,
				score,
				`Schema: ${page.schemaTypes.slice(0, 5).join(", ")}.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}`,
				"Add the page-type schema plus Organization/WebSite and BreadcrumbList; validate with the Rich Results Test.",
			);
		},
	},
];

const CATEGORY_LABEL: Record<SopCategory, string> = {
	technical: "Technical SEO",
	on_page: "On-Page SEO",
	geo: "GEO / AI readiness",
};

const SCORED_SCOPES: SopScope[] = ["page", "page_scoped_site", "psi"];

function competitorPrevalence(
	check: SopCheck,
	competitors: { features: PageFeatures; status: number }[],
	kt: string[],
): { pass: number; total: number } | null {
	if (check.scope !== "page") return null; // only page-level checks can be measured on competitors
	let pass = 0;
	let total = 0;
	for (const c of competitors) {
		if (!c.features.ok) continue;
		total++;
		const r = check.evaluate({
			page: c.features,
			httpStatus: c.status,
			keyword: "",
			kwTokens: kt,
			site: null,
			psi: null,
		});
		if (r.status === "pass") pass++;
	}
	return total > 0 ? { pass, total } : null;
}

export function evaluateSopScorecard(args: {
	target: PageFeatures;
	targetStatus: number;
	competitors: { features: PageFeatures; status: number }[];
	keyword: string;
	site: SiteSignals | null;
	psi: PageSpeedResult | null;
}): SopScorecard {
	const kt = kwTokens(args.keyword);
	const ctx: CheckCtx = {
		page: args.target,
		httpStatus: args.targetStatus,
		keyword: args.keyword,
		kwTokens: kt,
		site: args.site,
		psi: args.psi,
	};

	const results: SopItemResult[] = SOP_CHECKS.map(check => {
		const r = check.evaluate(ctx);
		return {
			id: check.id,
			sopRow: check.sopRow,
			sopSource: check.sopSource,
			category: check.category,
			title: check.title,
			weight: check.weight,
			scope: check.scope,
			status: r.status,
			score: Math.max(0, Math.min(1, r.score)),
			detail: r.detail,
			evidence: r.evidence ?? [],
			recommendation: r.recommendation,
			serpPrevalence: competitorPrevalence(check, args.competitors, kt),
		};
	});

	const categories: SopCategoryScore[] = (["technical", "on_page", "geo"] as SopCategory[]).map(cat => {
		const items = results.filter(r => r.category === cat);
		const scored = items.filter(
			r => SCORED_SCOPES.includes(r.scope) && r.status !== "unknown" && r.status !== "not_applicable",
		);
		const weight = scored.reduce((s, r) => s + r.weight, 0);
		const earned = scored.reduce((s, r) => s + r.weight * r.score, 0);
		return {
			category: cat,
			label: CATEGORY_LABEL[cat],
			score: weight > 0 ? Math.round((earned / weight) * 100) : 0,
			scoredWeight: weight,
			items: items.sort((a, b) => a.sopRow - b.sopRow),
		};
	});

	const allScored = results.filter(
		r => SCORED_SCOPES.includes(r.scope) && r.status !== "unknown" && r.status !== "not_applicable",
	);
	const totalWeight = allScored.reduce((s, r) => s + r.weight, 0);
	const totalEarned = allScored.reduce((s, r) => s + r.weight * r.score, 0);

	return {
		overall: totalWeight > 0 ? Math.round((totalEarned / totalWeight) * 100) : 0,
		scoredWeight: totalWeight,
		categories,
		dataSources: {
			psi: !!args.psi?.fetched,
			psiField: !!args.psi?.field.source,
			site: !!args.site?.robots.fetched,
		},
	};
}
