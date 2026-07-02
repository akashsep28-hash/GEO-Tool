/**
 * Standalone Schema Generator.
 *
 * Reuses the Page Gap Analyzer's schema sub-module (lib/page-gap-schema.ts)
 * WITHOUT running the full SERP/benchmark pipeline. Given just a URL we:
 *   1. render the page (Playwright → plain-fetch fallback),
 *   2. parse it with the shared audit-engine parser (analyzeRenderedHtml),
 *   3. derive the MINIMAL PageGapResult that generatePageSchema() consumes —
 *      a target record + the deterministic page-type verdict, with no
 *      competitors, no gaps and no SERP,
 *   4. hand it to the exact same generator the Page Gap tool calls.
 *
 * The page-gap module is imported, never modified. SERP-driven schema additions
 * (e.g. "3+ ranking pages ship Product") simply don't fire here because there are
 * no ranking pages to learn from; the foundation entities, the page-type primary
 * entity, breadcrumbs and an FAQPage (when the page exposes Q&A) are still emitted.
 */
import "server-only";
import { emitAgentEvent } from "@/lib/agent-runner";
import { aiAvailability, runWithModelOverride } from "@/lib/ai";
import { analyzeRenderedHtml, type PageAnalysis } from "@/lib/audit-engine";
import { BrowserSession, type DeviceMode } from "@/lib/browser";
import { env } from "@/lib/env";
import { computeIntentVerdict, extractFeatures } from "@/lib/page-gap-engine";
import type { PageGapResult, TargetRecord } from "@/lib/page-gap-run";
import { generatePageSchema, type SchemaResult } from "@/lib/page-gap-schema";

const MAX_STORED_HTML = 200_000;
const FETCH_TIMEOUT_MS = 20_000;
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------------------
// Deterministic FAQ extraction — reads the page's OWN visible Q&A so an FAQPage
// can be emitted even when no AI model is available (the generator only writes
// FAQ content when a model extracts it). This is extractive, never generative:
// every question + answer is lifted verbatim from the rendered HTML.
// ---------------------------------------------------------------------------

const FAQ_QUESTION_WORD =
	/^(who|what|when|where|why|how|is|are|can|could|does|do|did|should|would|will|which|has|have|am|may|must)\b/i;

function stripText(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#0*39;|&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&#(\d+);/g, (_, n) => {
			try {
				return String.fromCodePoint(Number(n));
			} catch {
				return "";
			}
		})
		.replace(/\s+/g, " ")
		.trim();
}

function ensureQuestionMark(s: string): string {
	const t = s.trim().replace(/\s+/g, " ");
	const cap = t.charAt(0).toUpperCase() + t.slice(1);
	return /\?\s*$/.test(cap) ? cap : `${cap}?`;
}

/**
 * Pull question/answer pairs from visible page structure: each question-like
 * heading (h2–h6 / summary / dt) and the text that follows it up to the next
 * such anchor becomes one Q&A. Bounded and deduped so stray headings don't leak.
 */
export function extractVisibleFaqs(html: string): { question: string; answer: string }[] {
	if (!html) return [];
	const cleaned = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

	const anchorRe = /<(h[2-6]|summary|dt)\b[^>]*>([\s\S]*?)<\/\1>/gi;
	const anchors: { start: number; end: number; text: string }[] = [];
	let m: RegExpExecArray | null;
	while ((m = anchorRe.exec(cleaned))) {
		anchors.push({ start: m.index, end: anchorRe.lastIndex, text: stripText(m[2]) });
	}

	const seen = new Set<string>();
	const out: { question: string; answer: string }[] = [];
	for (let i = 0; i < anchors.length; i++) {
		const q = anchors[i].text;
		if (q.length < 8 || q.length > 200) continue;
		if (!/\?\s*$/.test(q) && !FAQ_QUESTION_WORD.test(q)) continue;

		const next = anchors[i + 1];
		const segment = cleaned.slice(
			anchors[i].end,
			next ? next.start : Math.min(cleaned.length, anchors[i].end + 5000),
		);
		const answer = stripText(segment);
		if (answer.length < 20 || answer.length > 1800) continue;

		const key = q
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push({ question: ensureQuestionMark(q), answer });
		if (out.length >= 12) break;
	}
	return out;
}

function nodeTypes(n: Record<string, unknown>): string[] {
	const t = n["@type"];
	if (typeof t === "string") return [t];
	if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
	return [];
}

/**
 * If the generator produced no FAQPage (e.g. it fell back to the deterministic
 * skeleton because the model failed), build one from the page's visible Q&A so
 * the FAQ content the user can see on the page is actually marked up.
 */
function ensureFaqInSchema(schema: SchemaResult, html: string, url: string): SchemaResult {
	if (schema.jsonld.some(n => nodeTypes(n).some(t => /faqpage/i.test(t)))) return schema;
	const faqs = extractVisibleFaqs(html);
	if (faqs.length < 2) return schema; // a real FAQ section, not one stray heading

	const faqNode = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		"@id": `${url}#faqpage`,
		mainEntity: faqs.map(f => ({
			"@type": "Question",
			name: f.question,
			acceptedAnswer: { "@type": "Answer", text: f.answer },
		})),
	};

	return {
		...schema,
		jsonld: [...schema.jsonld, faqNode],
		types: [...new Set([...schema.types, "FAQPage"])],
		addedTypes: [...new Set([...schema.addedTypes, "FAQPage"])],
		recommendations: schema.recommendations.filter(r => r.type !== "FAQPage"),
		warnings: [
			...schema.warnings,
			`FAQPage built directly from the page’s ${faqs.length} visible Q&A — no model required.`,
		],
	};
}

// ---------------------------------------------------------------------------
// Deterministic listing extraction — a category/listing page (e.g. /explore/…)
// exposes its items as repeated "card title" elements. We lift those names into
// an ItemList and type the page as a CollectionPage. Names ONLY: prices, ratings
// and per-item URLs are deliberately not scraped, because associating them to the
// right item from flat HTML is error-prone and wrong markup is worse than none.
// ---------------------------------------------------------------------------

/** Repeated listing/card title elements → item names. */
export function extractListItems(html: string): string[] {
	if (!html) return [];
	const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
	// Elements whose class marks them as a listing/card/product title.
	const re =
		/class="[^"]*(?:card|item|product|listing|tile|result|activity|course|service)[-_]?title[^"]*"[^>]*>([\s\S]{1,400}?)<\//gi;
	const seen = new Set<string>();
	const out: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(cleaned))) {
		const name = stripText(m[1]);
		if (name.length < 3 || name.length > 140) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(name);
		if (out.length >= 30) break;
	}
	return out;
}

function stripHash(s: string): string {
	return s.replace(/[#?].*$/, "").toLowerCase();
}

/**
 * If the page is a listing (≥5 repeated card titles) and the generator didn't
 * already emit an ItemList, build one from those item names and type the page as
 * a CollectionPage (a subtype of WebPage) pointing at it via mainEntity.
 */
function ensureListInSchema(schema: SchemaResult, html: string, url: string): SchemaResult {
	if (schema.jsonld.some(n => nodeTypes(n).some(t => /^itemlist$/i.test(t)))) return schema;
	const items = extractListItems(html);
	if (items.length < 5) return schema; // a real listing, not a couple of stray cards

	const itemListId = `${url}#itemlist`;
	const itemList = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		"@id": itemListId,
		numberOfItems: items.length,
		itemListElement: items.map((name, i) => ({ "@type": "ListItem", position: i + 1, name })),
	};

	let collection = false;
	const pageKey = stripHash(url);
	const jsonld = schema.jsonld.map(n => {
		const types = nodeTypes(n);
		const isThisPage = types.some(t => /^webpage$/i.test(t)) && stripHash(String(n["@id"] ?? "")) === pageKey;
		if (!isThisPage) return n;
		const copy = { ...n };
		// Only upgrade a plain WebPage (hybrid/unknown pages). Don't override a real
		// primary entity (Article/Service) the generator deliberately chose.
		if (types.length === 1) {
			copy["@type"] = ["WebPage", "CollectionPage"];
			collection = true;
		}
		if (copy.mainEntity === undefined) copy.mainEntity = { "@id": itemListId };
		return copy;
	});

	return {
		...schema,
		jsonld: [...jsonld, itemList],
		types: [...new Set([...schema.types, "ItemList", ...(collection ? ["CollectionPage"] : [])])],
		addedTypes: [...new Set([...schema.addedTypes, "ItemList", ...(collection ? ["CollectionPage"] : [])])],
		recommendations: schema.recommendations.filter(r => !/^(itemlist|collectionpage)$/i.test(r.type)),
		warnings: [
			...schema.warnings,
			`ItemList built from ${items.length} listing items on the page${collection ? " (page typed as CollectionPage)" : ""} — no model required.`,
		],
	};
}

/** Plain server-side fetch — the fallback when the user's Chrome isn't available. */
async function plainFetch(url: string): Promise<{ html: string; finalUrl: string; status: number } | null> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
			redirect: "follow",
			signal: ctrl.signal,
		});
		const html = await res.text();
		return { html, finalUrl: res.url || url, status: res.status };
	} catch {
		return null;
	} finally {
		clearTimeout(t);
	}
}

/**
 * Render the target page. Playwright (the user's real Chrome) first, so
 * JS-rendered pages resolve exactly as the Page Gap tool sees them; a plain
 * fetch is the fallback when Chrome can't launch.
 */
async function renderTarget(rawUrl: string, device: DeviceMode): Promise<PageAnalysis> {
	const host = hostOf(rawUrl);

	const session = new BrowserSession();
	try {
		await session.open({ device });
		const r = await session.fetchRendered(rawUrl);
		if (r.ok && r.html) {
			return analyzeRenderedHtml(r.html, rawUrl, r.finalUrl, hostOf(r.finalUrl) || host, { status: r.status });
		}
	} catch {
		/* Chrome unavailable / launch failed — fall through to a plain fetch. */
	} finally {
		await session.close();
	}

	const plain = await plainFetch(rawUrl);
	if (plain?.html) {
		return analyzeRenderedHtml(plain.html, rawUrl, plain.finalUrl, hostOf(plain.finalUrl) || host, {
			status: plain.status,
		});
	}

	const empty = analyzeRenderedHtml("", rawUrl, rawUrl, host, { status: 0 });
	empty.ok = false;
	empty.issues = ["The page could not be fetched (Chrome render and plain fetch both failed)."];
	return empty;
}

export type SchemaGenMeta = {
	url: string;
	finalUrl: string;
	title: string;
	domain: string;
	pageType: string;
	wordCount: number;
	ok: boolean;
};

export type SchemaGenResult = {
	schema: SchemaResult;
	meta: SchemaGenMeta;
};

/**
 * Assemble the minimal PageGapResult that generatePageSchema() reads. Only the
 * fields the generator/plan/graph actually consume carry data (target, keyword,
 * country, intent.targetPageType — plus empty benchmark/gaps and a null
 * promptFinder, all of which the generator handles). The scored/SERP fields the
 * generator never touches are valid empties; this object is a generation adapter
 * that is never persisted or scored.
 */
function buildSchemaOnlyReport(
	analysis: PageAnalysis,
	keyword: string,
	country: string,
	device: DeviceMode,
): PageGapResult {
	const features = extractFeatures(analysis, 0);
	const intent = computeIntentVerdict(keyword, [], features);

	const target: TargetRecord = {
		url: analysis.url,
		finalUrl: analysis.finalUrl,
		domain: features.domain,
		status: analysis.status,
		ok: analysis.ok,
		error: analysis.ok ? undefined : analysis.issues[0],
		title: analysis.title,
		metaDescription: analysis.metaDescription,
		wordCount: analysis.wordCount,
		htmlBytes: analysis.html.length,
		html: analysis.html.slice(0, MAX_STORED_HTML),
		headings: { h1: analysis.h1Texts, h2: analysis.h2Texts, h3: analysis.h3Texts },
		links: analysis.links.map(l => ({ url: l.url, text: l.text, kind: l.kind })),
		schemaTypes: analysis.schemaTypes,
		features,
	};

	return {
		keyword,
		targetUrl: analysis.url,
		country,
		device,
		fetchedAt: new Date().toISOString(),
		score: 0,
		dimensionScore: 0,
		subScores: {} as PageGapResult["subScores"],
		sopScorecard: null as unknown as PageGapResult["sopScorecard"],
		siteSignals: null,
		pageSpeed: null,
		intent,
		serp: { keyword, results: [] } as unknown as PageGapResult["serp"],
		benchmark: [], // no competitors → no SERP-driven schema additions
		target,
		competitors: [],
		gaps: [],
		serpValidatedGaps: [],
		lowConfidenceGaps: [],
		promptFinder: null as unknown as PageGapResult["promptFinder"],
		warnings: [],
	};
}

/**
 * Run the generator, and if AI generation didn't succeed even though a LOCAL
 * model is connected (the configured model errored/OOM-crashed mid-run), retry
 * once on a smaller local fallback model (Gemma by default) on the SAME server.
 * The fallback only fires for local providers — falling back to a local model
 * makes no sense when the connected provider is hosted OpenAI/Anthropic.
 */
async function generateWithLocalFallback(report: PageGapResult): Promise<SchemaResult> {
	const first = await generatePageSchema(report);
	if (first.source === "ai") return first;

	const avail = await aiAvailability();
	const isLocal = avail.available && (avail.source === "local" || (avail.label?.startsWith("Local:") ?? false));
	const fallbackModel = env.localLlmFallbackModel.trim();
	// Skip if no local provider, no fallback configured, or the primary model IS
	// already the fallback (retrying the same model would just fail again).
	if (!isLocal || !fallbackModel || (avail.label?.includes(fallbackModel) ?? false)) return first;

	try {
		emitAgentEvent({
			agent: "pipeline",
			phase: "note",
			attempt: 0,
			detail: `Primary model failed — retrying on the fallback model "${fallbackModel}"…`,
		});
		const retry = await runWithModelOverride(fallbackModel, () => generatePageSchema(report));
		if (retry.source === "ai") {
			retry.warnings = [
				`Primary local model failed — generated with the fallback model "${fallbackModel}".`,
				...retry.warnings,
			];
			return retry;
		}
	} catch {
		/* fallback also failed — keep the deterministic first result below */
	}
	return first;
}

/**
 * Generate Schema.org JSON-LD for a single URL using the Page Gap schema engine.
 * `keyword` is optional — it only seeds soft naming/serviceType fallbacks, so we
 * default to the page's own title/H1 when none is supplied.
 */
export async function generateSchemaForUrl(
	rawUrl: string,
	opts: { keyword?: string; country?: string; device?: DeviceMode } = {},
): Promise<SchemaGenResult> {
	const device: DeviceMode = opts.device ?? "desktop";
	const country = (opts.country || "us").toLowerCase();
	emitAgentEvent({
		agent: "pipeline",
		phase: "note",
		attempt: 0,
		detail: `Rendering ${rawUrl} in Chrome (${device})…`,
	});
	const analysis = await renderTarget(rawUrl, device);
	emitAgentEvent({
		agent: "pipeline",
		phase: "note",
		attempt: 0,
		detail: analysis.ok
			? `Page rendered — ${analysis.wordCount} words, ${analysis.schemaTypes.length} existing schema type(s). Planning the schema set…`
			: "Chrome render failed — fell back to a direct fetch.",
	});
	const keyword = (opts.keyword || analysis.title || analysis.h1Texts[0] || "").trim();
	const report = buildSchemaOnlyReport(analysis, keyword, country, device);
	let schema = await generateWithLocalFallback(report);
	// Guarantee FAQ + listing markup from the page's own visible content even when
	// no model ran (the generator only writes these when a model extracts them).
	const pageUrl = report.target.finalUrl || report.targetUrl;
	schema = ensureFaqInSchema(schema, report.target.html, pageUrl);
	schema = ensureListInSchema(schema, report.target.html, pageUrl);

	return {
		schema,
		meta: {
			url: report.targetUrl,
			finalUrl: report.target.finalUrl,
			title: report.target.title,
			domain: report.target.domain,
			pageType: report.intent.targetPageType,
			wordCount: report.target.wordCount,
			ok: report.target.ok,
		},
	};
}
