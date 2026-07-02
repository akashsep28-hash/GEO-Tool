/**
 * SERP fetch + parse for the Page Gap Analyzer.
 *
 * Uses the BrowserSession (lib/browser.ts → user's Chrome via Playwright) to open
 * Google, then extracts the top organic results and SERP features. The raw result
 * extraction runs in the page DOM (most robust against Google markup churn); the
 * cleanup, redirect-resolution, and ranking happen in Node.
 */
import "server-only";
import type { Page } from "playwright-core";
import type { BrowserSession } from "@/lib/browser";

export type SerpResult = {
	rank: number;
	title: string;
	url: string;
	domain: string;
	snippet: string;
};

export type SerpFeatures = {
	featuredSnippet: boolean;
	peopleAlsoAsk: boolean;
	relatedSearches: boolean;
	localPack: boolean;
	ads: boolean;
	videoCarousel: boolean;
};

export type SerpData = {
	keyword: string;
	country: string;
	device: string;
	results: SerpResult[];
	features: SerpFeatures;
	rawHtmlBytes: number;
	fetchedAt: string;
	error?: string;
};

type RawResult = { href: string; title: string; snippet: string };

const EMPTY_FEATURES: SerpFeatures = {
	featuredSnippet: false,
	peopleAlsoAsk: false,
	relatedSearches: false,
	localPack: false,
	ads: false,
	videoCarousel: false,
};

function buildSerpUrl(keyword: string, country: string): string {
	const params = new URLSearchParams({
		q: keyword,
		hl: "en",
		gl: country || "us",
		pws: "0",
	});
	return `https://www.google.com/search?${params.toString()}`;
}

function isBlocked(url: string, bodyText: string): boolean {
	return (
		/\/sorry\/|consent\.google\./i.test(url) ||
		/unusual traffic|not a robot|detected unusual|enablejs|recaptcha/i.test(bodyText)
	);
}

const CONSENT_SELECTORS = [
	"#L2AGLb",
	'button:has-text("Reject all")',
	'button:has-text("Accept all")',
	'button:has-text("I agree")',
];

async function dismissConsent(page: Page): Promise<void> {
	for (const sel of CONSENT_SELECTORS) {
		try {
			const btn = page.locator(sel).first();
			if (await btn.count()) {
				await btn.click({ timeout: 1500 });
				await page.waitForTimeout(400);
				return;
			}
		} catch {
			/* keep trying the next selector */
		}
	}
}

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./i, "");
	} catch {
		return "";
	}
}

/** Resolve Google's /url?q= redirect wrappers to the real destination. */
function resolveHref(href: string): string | null {
	try {
		const u = new URL(href);
		const host = u.hostname.toLowerCase();
		if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === "/url") {
			const q = u.searchParams.get("q") || u.searchParams.get("url");
			return q ?? null;
		}
		return href;
	} catch {
		return null;
	}
}

function isOrganicHost(host: string): boolean {
	if (!host) return false;
	return !/(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|youtube\.com\/redirect|googleadservices\.com|policies\.google)/.test(
		host,
	);
}

type Extracted = {
	raw: RawResult[];
	features: SerpFeatures;
	htmlBytes: number;
	bodyText: string;
	hasResults: boolean;
};

/** Pull organic results + SERP features out of the current page DOM. */
async function extractSerp(page: Page): Promise<Extracted> {
	const data = await page.evaluate(() => {
		const results: { href: string; title: string; snippet: string }[] = [];
		const SNIPPET_SEL = ".VwiC3b, .yXK7lf, [data-sncf], .lyLwlc, .lEBKkf, .s3v9rd, .ITZIwc";
		const CONTAINER_SEL =
			"div.g, div[data-hveid], div[data-sokoban-container], div.MjjYud, div.xpd, div.Gx5Zad, div.kCrYT";
		const seenHref = new Set<string>();

		// Title nodes work across desktop AND mobile layouts. Desktop nests <h3>
		// inside the result <a>; mobile often places the heading as a sibling or in
		// a role="heading" div, so we resolve each heading to its result link
		// (ancestor anchor → descendant anchor → first link in the result block).
		const titleNodes = Array.from(
			document.querySelectorAll<HTMLElement>('h3, [role="heading"][aria-level="3"], a[href] div[role="heading"]'),
		);
		for (const tn of titleNodes) {
			const title = (tn.textContent || "").trim();
			if (!title) continue;
			let a =
				(tn.closest("a[href]") as HTMLAnchorElement | null) ||
				(tn.querySelector("a[href]") as HTMLAnchorElement | null);
			const container = tn.closest(CONTAINER_SEL);
			if (!a && container) {
				a = container.querySelector("a[href]") as HTMLAnchorElement | null;
			}
			const href = a?.href;
			if (!href || seenHref.has(href)) continue;
			seenHref.add(href);
			let snippet = "";
			if (container) {
				const snipEl = container.querySelector(SNIPPET_SEL);
				if (snipEl) snippet = (snipEl.textContent || "").trim();
			}
			results.push({ href, title, snippet });
			if (results.length >= 25) break;
		}

		const bodyText = (document.body.innerText || "").slice(0, 6000);
		const has = (sel: string) => !!document.querySelector(sel);
		const features = {
			featuredSnippet: has(".xpdopen, .ifM9O, .c2xzTb, .V3FYCf"),
			peopleAlsoAsk: /People also ask/i.test(bodyText) || has('[jsname="N760b"], .related-question-pair'),
			relatedSearches: /Related searches/i.test(bodyText) || has(".k8XOCe, .EASEnb"),
			localPack:
				has('.rllt__details, [data-attrid^="kc:/local"], .VkpGBb') || /\bPlaces\b/.test(bodyText.slice(0, 1500)),
			ads: has("[data-text-ad], .uEierd, .v5yQqb") || /\bSponsored\b/.test(bodyText.slice(0, 3000)),
			videoCarousel: has("video-voyager, .RzdJxc, .uVMCKf"),
		};

		return {
			raw: results,
			features,
			htmlBytes: document.documentElement.outerHTML.length,
			bodyText,
			hasResults: results.length > 0,
		};
	});
	return {
		raw: data.raw as RawResult[],
		features: data.features as SerpFeatures,
		htmlBytes: data.htmlBytes,
		bodyText: data.bodyText,
		hasResults: data.hasResults,
	};
}

/** Poll a visible page until the user has cleared the bot check / results appear. */
async function waitForSolve(page: Page, maxMs: number): Promise<boolean> {
	const deadline = Date.now() + maxMs;
	while (Date.now() < deadline) {
		await page.waitForTimeout(2500);
		const state = await page
			.evaluate(() => ({
				url: location.href,
				body: (document.body.innerText || "").slice(0, 500),
				hasResults: document.querySelectorAll('h3, [role="heading"][aria-level="3"]').length > 0,
			}))
			.catch(() => null);
		if (!state) continue;
		if (state.hasResults && !isBlocked(state.url, state.body)) return true;
	}
	return false;
}

function cleanResults(raw: RawResult[]): SerpResult[] {
	const seen = new Set<string>();
	const results: SerpResult[] = [];
	for (const r of raw) {
		const resolved = resolveHref(r.href);
		if (!resolved) continue;
		const host = domainOf(resolved);
		if (!isOrganicHost(host)) continue;
		const key = resolved.split("#")[0];
		if (seen.has(key)) continue;
		seen.add(key);
		results.push({
			rank: results.length + 1,
			title: r.title,
			url: resolved,
			domain: host,
			snippet: r.snippet,
		});
		if (results.length >= 10) break;
	}
	return results;
}

export type FetchSerpOptions = {
	country?: string;
	device?: string;
	/** Headed mode: pause and let the user clear Google's bot check manually. */
	interactive?: boolean;
	/** How long to wait for a manual solve (ms). Default 180s. */
	solveTimeoutMs?: number;
};

/** Fetch and parse the top-10 organic SERP for a keyword. Never throws. */
export async function fetchSerp(
	session: BrowserSession,
	keyword: string,
	opts: FetchSerpOptions = {},
): Promise<SerpData> {
	const country = (opts.country || "us").toLowerCase();
	const device = opts.device || "desktop";
	const interactive = !!opts.interactive;
	const solveTimeoutMs = opts.solveTimeoutMs ?? 180_000;
	const base: Omit<SerpData, "results" | "features" | "rawHtmlBytes"> = {
		keyword,
		country,
		device,
		fetchedAt: new Date().toISOString(),
	};

	const maxAttempts = interactive ? 1 : 2;
	let lastError = "";

	try {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const outcome = await session.withPage(
				async (page): Promise<{ blocked: true } | { blocked: false; data: Extracted }> => {
					// Warm up on the homepage to pick up Google's session cookies.
					try {
						await page.goto("https://www.google.com/ncr", {
							waitUntil: "domcontentloaded",
						});
						await dismissConsent(page);
						await page.waitForTimeout(500);
					} catch {
						/* warm-up is best effort */
					}

					await page.goto(buildSerpUrl(keyword, country), {
						waitUntil: "domcontentloaded",
					});
					await dismissConsent(page);
					await page.waitForTimeout(900 + attempt * 1200);

					let data = await extractSerp(page);
					const blocked = isBlocked(page.url(), data.bodyText);

					if (blocked || !data.hasResults) {
						if (interactive) {
							const solved = await waitForSolve(page, solveTimeoutMs);
							if (!solved) return { blocked: true };
							data = await extractSerp(page);
							if (!data.hasResults) return { blocked: true };
						} else if (blocked) {
							return { blocked: true };
						}
					}
					return { blocked: false, data };
				},
			);

			if (outcome.blocked) {
				lastError = interactive
					? "Timed out waiting for the Google check to be cleared. Re-run and complete the challenge in the Chrome window that opens."
					: 'Google returned a bot-check ("unusual traffic") page. Use "Re-run (solve CAPTCHA)" to clear it manually in a visible Chrome window.';
				if (!interactive && attempt < maxAttempts - 1) {
					await new Promise(r => setTimeout(r, 4000));
					continue;
				}
				break;
			}

			const results = cleanResults(outcome.data.raw);
			if (results.length === 0) {
				lastError = "No organic results could be parsed from the SERP.";
				continue;
			}
			return {
				...base,
				results,
				features: outcome.data.features,
				rawHtmlBytes: outcome.data.htmlBytes,
			};
		}

		return {
			...base,
			results: [],
			features: EMPTY_FEATURES,
			rawHtmlBytes: 0,
			error: lastError || "No organic results could be parsed from the SERP.",
		};
	} catch (e) {
		return {
			...base,
			results: [],
			features: EMPTY_FEATURES,
			rawHtmlBytes: 0,
			error: `SERP fetch failed: ${(e as Error).message}`,
		};
	}
}
