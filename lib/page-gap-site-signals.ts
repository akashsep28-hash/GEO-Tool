/**
 * Page Gap Analyzer — page-scoped site signals (deterministic, no LLM).
 *
 * Several SOP rows (robots.txt crawlability, XML sitemap, HTTPS/redirects,
 * SSR/JS-rendering) live at the domain level, but the user's agenda is a
 * page-level analysis. So for each we fetch the domain resource ONCE and report
 * only the slice about THIS exact URL:
 *   - robots.txt → is THIS path crawlable by Google + the major AI bots?
 *   - sitemap    → is THIS URL listed?
 *   - HTTPS      → does THIS URL serve clean HTTPS (and does http:// redirect)?
 *   - redirects  → how many hops does THIS URL take, and is there a loop?
 *   - SSR        → does the no-JS HTML carry THIS page's core content?
 *
 * Everything is best-effort with short timeouts and never throws; a failed
 * fetch yields `fetched:false` so the dependent SOP rows read "unknown" rather
 * than failing.
 */
import "server-only";

const UA = "Mozilla/5.0 (compatible; FirstRankerGEOBot/2.0; +https://thefirstranker.app)";
const FETCH_TIMEOUT_MS = 8000;
const MAX_SITEMAP_DOCS = 20;
const MAX_SITEMAP_URLS = 5000;
const MAX_REDIRECT_HOPS = 8;

/** The AI/search crawlers the SOP (row 1) calls out explicitly. */
export const AI_CRAWLERS = [
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	"PerplexityBot",
	"ClaudeBot",
	"Google-Extended",
	"CCBot",
] as const;

export type CrawlDecision = { agent: string; allowed: boolean };

export type SiteSignals = {
	robots: {
		fetched: boolean;
		exists: boolean;
		googleAllowed: boolean | null;
		aiBots: CrawlDecision[];
		blockedAiBots: string[];
	};
	sitemap: {
		fetched: boolean;
		found: boolean;
		urlListed: boolean | null; // null when not found or capped before a match
		docsChecked: number;
		urlsScanned: number;
		capped: boolean;
	};
	https: {
		isHttps: boolean;
		httpRedirectsToHttps: boolean | null; // null when not tested/unreachable
	};
	redirect: {
		hops: number;
		chain: string[];
		loop: boolean;
		finalStatus: number;
	};
	ssr: {
		fetched: boolean;
		rawWordCount: number;
		rawHasH1: boolean;
		/** rawWordCount / renderedWordCount, capped at 1. */
		ratio: number;
	};
};

// ---------------------------------------------------------------------------
// robots.txt parsing (Google's matching semantics: longest match wins, ties
// go to Allow; `*` wildcard and `$` end-anchor supported).
// ---------------------------------------------------------------------------

type RobotsGroup = { agents: string[]; allow: string[]; disallow: string[] };

function parseRobots(txt: string): RobotsGroup[] {
	const groups: RobotsGroup[] = [];
	let current: RobotsGroup | null = null;
	let sawDirective = false;
	for (const raw of txt.split(/\r?\n/)) {
		const line = raw.split("#")[0].trim();
		if (!line) continue;
		const idx = line.indexOf(":");
		if (idx < 0) continue;
		const key = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();
		if (key === "user-agent") {
			// A new agent line after a directive starts a fresh group.
			if (!current || sawDirective) {
				current = { agents: [], allow: [], disallow: [] };
				groups.push(current);
				sawDirective = false;
			}
			current.agents.push(value.toLowerCase());
		} else if (key === "disallow" && current) {
			current.disallow.push(value);
			sawDirective = true;
		} else if (key === "allow" && current) {
			current.allow.push(value);
			sawDirective = true;
		}
	}
	return groups;
}

function ruleToRegex(rule: string): RegExp {
	const anchored = rule.endsWith("$");
	const body = anchored ? rule.slice(0, -1) : rule;
	let re = "";
	for (const ch of body) {
		if (ch === "*") re += ".*";
		else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${re}${anchored ? "$" : ""}`);
}

function matchLen(path: string, rules: string[]): number {
	let best = -1;
	for (const rule of rules) {
		if (rule === "") continue;
		if (ruleToRegex(rule).test(path)) best = Math.max(best, rule.replace(/\$$/, "").length);
	}
	return best;
}

/** Pick the most specific group for an agent (exact token match, else `*`). */
function groupsFor(groups: RobotsGroup[], agent: string): RobotsGroup[] {
	const a = agent.toLowerCase();
	const exact = groups.filter(g => g.agents.some(x => x === a));
	if (exact.length) return exact;
	return groups.filter(g => g.agents.includes("*"));
}

export function isAllowed(groups: RobotsGroup[], path: string, agent: string): boolean {
	const mine = groupsFor(groups, agent);
	if (!mine.length) return true; // no applicable group ⇒ allowed
	const allow = mine.flatMap(g => g.allow);
	const disallow = mine.flatMap(g => g.disallow);
	// An empty Disallow ("Disallow:") means allow everything.
	const hasBlanketAllow = disallow.every(d => d === "");
	if (hasBlanketAllow) return true;
	const allowLen = matchLen(path, allow);
	const disallowLen = matchLen(path, disallow);
	if (disallowLen < 0) return true; // nothing disallows this path
	return allowLen >= disallowLen; // ties go to allow (Google semantics)
}

async function safeText(
	url: string,
	timeoutMs = FETCH_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; text: string }> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal, redirect: "follow" });
		const text = res.ok ? await res.text() : "";
		return { ok: res.ok, status: res.status, text };
	} catch {
		return { ok: false, status: 0, text: "" };
	} finally {
		clearTimeout(timer);
	}
}

// ---------------------------------------------------------------------------
// Sitemap membership
// ---------------------------------------------------------------------------

function extractLocs(xml: string): string[] {
	const out: string[] = [];
	const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		out.push(m[1].trim().replace(/&amp;/g, "&"));
	}
	return out;
}

function normUrl(u: string): string {
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

async function checkSitemap(origin: string, robotsTxt: string, targetUrl: string): Promise<SiteSignals["sitemap"]> {
	const fromRobots = robotsTxt
		.split(/\r?\n/)
		.map(l => l.match(/^\s*sitemap:\s*(.+)\s*$/i)?.[1]?.trim())
		.filter((v): v is string => !!v);
	const queue = [...new Set([...fromRobots, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])];
	const seen = new Set<string>();
	const wantedNorm = normUrl(targetUrl);

	let found = false;
	let docsChecked = 0;
	let urlsScanned = 0;
	let capped = false;

	while (queue.length && docsChecked < MAX_SITEMAP_DOCS && urlsScanned < MAX_SITEMAP_URLS) {
		const sm = queue.shift()!;
		if (seen.has(sm)) continue;
		seen.add(sm);
		const { ok, text } = await safeText(sm);
		if (!ok || !text) continue;
		found = true;
		docsChecked++;
		for (const loc of extractLocs(text)) {
			if (/\.xml(\?|#|$)/i.test(loc)) {
				if (queue.length + seen.size < MAX_SITEMAP_DOCS) queue.push(loc);
				continue;
			}
			urlsScanned++;
			if (normUrl(loc) === wantedNorm) {
				return { fetched: true, found, urlListed: true, docsChecked, urlsScanned, capped: false };
			}
			if (urlsScanned >= MAX_SITEMAP_URLS) {
				capped = true;
				break;
			}
		}
	}
	if (queue.length && (docsChecked >= MAX_SITEMAP_DOCS || urlsScanned >= MAX_SITEMAP_URLS)) capped = true;

	return {
		fetched: true,
		found,
		urlListed: found ? (capped ? null : false) : null,
		docsChecked,
		urlsScanned,
		capped,
	};
}

// ---------------------------------------------------------------------------
// Redirect trace (manual, page-scoped)
// ---------------------------------------------------------------------------

async function traceRedirects(startUrl: string): Promise<SiteSignals["redirect"]> {
	const chain: string[] = [];
	const seen = new Set<string>();
	let url = startUrl;
	let hops = 0;
	let loop = false;
	let finalStatus = 0;

	for (let i = 0; i < MAX_REDIRECT_HOPS; i++) {
		chain.push(url);
		if (seen.has(url)) {
			loop = true;
			break;
		}
		seen.add(url);
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
		try {
			const res = await fetch(url, {
				method: "GET",
				headers: { "User-Agent": UA },
				redirect: "manual",
				signal: ctrl.signal,
			});
			finalStatus = res.status;
			if (res.status >= 300 && res.status < 400) {
				const loc = res.headers.get("location");
				if (!loc) break;
				url = new URL(loc, url).toString();
				hops++;
				continue;
			}
			break; // non-redirect: done
		} catch {
			break;
		} finally {
			clearTimeout(timer);
		}
	}
	return { hops, chain, loop, finalStatus };
}

async function checkHttpRedirect(targetUrl: string): Promise<boolean | null> {
	let httpUrl: string;
	try {
		const u = new URL(targetUrl);
		if (u.protocol !== "https:") return null; // only relevant for an https target
		u.protocol = "http:";
		httpUrl = u.toString();
	} catch {
		return null;
	}
	const trace = await traceRedirects(httpUrl);
	const last = trace.chain[trace.chain.length - 1] ?? "";
	if (!trace.finalStatus) return null;
	return /^https:/i.test(last);
}

// ---------------------------------------------------------------------------
// SSR / no-JS content check
// ---------------------------------------------------------------------------

function stripToText(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

async function checkSsr(targetUrl: string, renderedWordCount: number): Promise<SiteSignals["ssr"]> {
	const { ok, text } = await safeText(targetUrl, FETCH_TIMEOUT_MS);
	if (!ok || !text) return { fetched: false, rawWordCount: 0, rawHasH1: false, ratio: 0 };
	const rawHasH1 = /<h1\b/i.test(text);
	const rawWordCount = stripToText(text).split(/\s+/).filter(Boolean).length;
	const ratio = renderedWordCount > 0 ? Math.min(1, rawWordCount / renderedWordCount) : rawWordCount > 0 ? 1 : 0;
	return { fetched: true, rawWordCount, rawHasH1, ratio };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function fetchSiteSignals(targetUrl: string, renderedWordCount: number): Promise<SiteSignals> {
	let origin = "";
	let path = "/";
	let isHttps = false;
	try {
		const u = new URL(targetUrl);
		origin = u.origin;
		path = u.pathname || "/";
		isHttps = u.protocol === "https:";
	} catch {
		// Unparseable URL — return an all-unknown shell.
		return {
			robots: { fetched: false, exists: false, googleAllowed: null, aiBots: [], blockedAiBots: [] },
			sitemap: { fetched: false, found: false, urlListed: null, docsChecked: 0, urlsScanned: 0, capped: false },
			https: { isHttps: false, httpRedirectsToHttps: null },
			redirect: { hops: 0, chain: [], loop: false, finalStatus: 0 },
			ssr: { fetched: false, rawWordCount: 0, rawHasH1: false, ratio: 0 },
		};
	}

	const robotsRes = await safeText(`${origin}/robots.txt`);
	const robotsExists = robotsRes.ok && robotsRes.text.trim().length > 0;
	const groups = robotsExists ? parseRobots(robotsRes.text) : [];
	const googleAllowed = robotsExists ? isAllowed(groups, path, "Googlebot") : true;
	const aiBots: CrawlDecision[] = AI_CRAWLERS.map(agent => ({
		agent,
		allowed: robotsExists ? isAllowed(groups, path, agent) : true,
	}));

	// The three remaining checks are independent — run them in parallel.
	const [sitemap, httpRedirectsToHttps, redirect, ssr] = await Promise.all([
		checkSitemap(origin, robotsExists ? robotsRes.text : "", targetUrl),
		checkHttpRedirect(targetUrl),
		traceRedirects(targetUrl),
		checkSsr(targetUrl, renderedWordCount),
	]);

	return {
		robots: {
			fetched: robotsRes.status !== 0,
			exists: robotsExists,
			googleAllowed,
			aiBots,
			blockedAiBots: aiBots.filter(b => !b.allowed).map(b => b.agent),
		},
		sitemap,
		https: { isHttps, httpRedirectsToHttps },
		redirect,
		ssr,
	};
}
