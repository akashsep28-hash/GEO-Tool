/**
 * Page Gap Analyzer — run orchestrator (deterministic, no LLM).
 *
 * Single integrated pipeline (matches the spec):
 *   keyword + url
 *     → open Chrome (Playwright)
 *     → fetch SERP, extract top 10 organic
 *     → visit all 10 + the target, capture rendered HTML, parse with the
 *       existing audit-engine parser, extract page features
 *     → intent verdict (7-rule gate)
 *     → benchmark dataset
 *     → SERP-sourced gap engine (3+ evidence)
 *     → score
 * The LLM narrative is added separately (lib/page-gap-llm.ts), once per run.
 */
import "server-only";
import { analyzeRenderedHtml, type PageAnalysis } from "@/lib/audit-engine";
import { BrowserSession, type DeviceMode, politeDelay } from "@/lib/browser";
import {
	type BenchmarkRow,
	buildBenchmark,
	computeIntentVerdict,
	extractFeatures,
	type Gap,
	type IntentVerdict,
	type PageFeatures,
	type SubScores,
	scorePageGap,
	sourceGaps,
} from "@/lib/page-gap-engine";
import { fetchSiteSignals, type SiteSignals } from "@/lib/page-gap-site-signals";
import { evaluateSopScorecard, type SopScorecard } from "@/lib/page-gap-sop";
import { fetchPageSpeed, type PageSpeedResult } from "@/lib/pagespeed";
import { buildPromptFinder, type PromptFinderResult } from "@/lib/prompt-finder";
import { fetchSerp, type SerpData } from "@/lib/serp";

const MAX_STORED_HTML = 200_000;
const MAX_STORED_COMPETITOR_HTML = 150_000;
const MAX_STORED_LINKS = 150;

export type TargetRecord = {
	url: string;
	finalUrl: string;
	domain: string;
	status: number;
	ok: boolean;
	error?: string;
	title: string;
	metaDescription: string;
	wordCount: number;
	htmlBytes: number;
	html: string;
	headings: { h1: string[]; h2: string[]; h3: string[] };
	links: { url: string; text: string; kind: string }[];
	schemaTypes: string[];
	features: PageFeatures;
};

export type CompetitorRecord = {
	rank: number;
	url: string;
	finalUrl: string;
	domain: string;
	status: number;
	ok: boolean;
	error?: string;
	title: string;
	wordCount: number;
	htmlBytes: number;
	/** Rendered HTML captured by Playwright (capped). Powers the bulk download. */
	html: string;
	features: PageFeatures;
};

export type PageGapResult = {
	keyword: string;
	targetUrl: string;
	country: string;
	device: string;
	fetchedAt: string;
	/** Headline score — the SOP scorecard overall (0–100). */
	score: number;
	/** Legacy 8-dimension composite, kept as a secondary internal view. */
	dimensionScore: number;
	subScores: SubScores;
	/** SOP line-item scorecard (Tech · On-Page · GEO). */
	sopScorecard: SopScorecard;
	/** Page-scoped site signals (robots/sitemap/https/ssr/redirects). */
	siteSignals: SiteSignals | null;
	/** PageSpeed Insights (mobile) — CrUX field + Lighthouse lab. */
	pageSpeed: PageSpeedResult | null;
	intent: IntentVerdict;
	serp: SerpData;
	benchmark: BenchmarkRow[];
	target: TargetRecord;
	competitors: CompetitorRecord[];
	gaps: Gap[];
	serpValidatedGaps: Gap[];
	lowConfidenceGaps: Gap[];
	promptFinder: PromptFinderResult;
	warnings: string[];
};

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

function emptyAnalysis(url: string, error: string): PageAnalysis {
	const a = analyzeRenderedHtml("", url, url, hostOf(url), { status: 0 });
	a.ok = false;
	a.issues = [error];
	return a;
}

export type ProgressEvent = {
	stage: "starting" | "serp" | "competitor" | "target" | "scoring" | "done";
	label: string;
	/** 0–100 overall progress. */
	pct: number;
	current?: number;
	total?: number;
};

export type RunOptions = {
	country?: string;
	device?: DeviceMode;
	/** Headed mode: let the user clear Google's bot check manually. */
	interactive?: boolean;
	/** Real-time progress callback (drives the loading bar in the UI). */
	onProgress?: (e: ProgressEvent) => void;
};

export async function runPageGap(rawUrl: string, keyword: string, opts: RunOptions = {}): Promise<PageGapResult> {
	const country = (opts.country || "us").toLowerCase();
	const device: DeviceMode = opts.device || "desktop";
	const warnings: string[] = [];
	const session = new BrowserSession();
	const report = (e: ProgressEvent) => {
		try {
			opts.onProgress?.(e);
		} catch {
			/* never let progress reporting break the run */
		}
	};

	let serp: SerpData;
	const competitors: CompetitorRecord[] = [];
	let targetAnalysis: PageAnalysis;

	try {
		report({
			stage: "starting",
			label: opts.interactive ? "Opening a visible Chrome window…" : "Opening Chrome…",
			pct: 3,
		});
		await session.open({ device, interactive: opts.interactive });

		// 1. SERP
		report({
			stage: "serp",
			label: opts.interactive ? "Loading Google — solve the check if shown…" : "Reading the live Google SERP…",
			pct: 8,
		});
		serp = await fetchSerp(session, keyword, {
			country,
			device,
			interactive: opts.interactive,
		});
		if (serp.error) warnings.push(serp.error);

		// 2. Visit each ranking URL
		const totalPages = serp.results.length + 1; // competitors + target
		report({
			stage: "serp",
			label: `Found ${serp.results.length} ranking pages. Auditing each…`,
			pct: 12,
			current: 0,
			total: totalPages,
		});
		let pageIdx = 0;
		for (const result of serp.results) {
			await politeDelay();
			pageIdx++;
			report({
				stage: "competitor",
				label: `Auditing #${result.rank} ${result.domain}`,
				// Spread competitor work across 12% → 82%.
				pct: 12 + Math.round((pageIdx / totalPages) * 70),
				current: pageIdx,
				total: totalPages,
			});
			const rendered = await session.fetchRendered(result.url);
			let analysis: PageAnalysis;
			if (rendered.ok && rendered.html) {
				analysis = analyzeRenderedHtml(
					rendered.html,
					result.url,
					rendered.finalUrl,
					hostOf(rendered.finalUrl) || result.domain,
					{ status: rendered.status },
				);
			} else {
				analysis = emptyAnalysis(result.url, rendered.error || "Page failed to render");
				warnings.push(`Rank ${result.rank} (${result.domain}) could not be fetched.`);
			}
			const features = extractFeatures(analysis, result.rank);
			competitors.push({
				rank: result.rank,
				url: result.url,
				finalUrl: analysis.finalUrl,
				domain: result.domain,
				status: analysis.status,
				ok: analysis.ok,
				error: analysis.ok ? undefined : analysis.issues[0],
				title: analysis.title,
				wordCount: analysis.wordCount,
				htmlBytes: rendered.html.length,
				html: (rendered.html || "").slice(0, MAX_STORED_COMPETITOR_HTML),
				features,
			});
		}

		// 3. Target
		report({
			stage: "target",
			label: "Auditing your target page…",
			pct: 86,
		});
		await politeDelay();
		const renderedTarget = await session.fetchRendered(rawUrl);
		if (renderedTarget.ok && renderedTarget.html) {
			targetAnalysis = analyzeRenderedHtml(
				renderedTarget.html,
				rawUrl,
				renderedTarget.finalUrl,
				hostOf(renderedTarget.finalUrl) || hostOf(rawUrl),
				{ status: renderedTarget.status },
			);
		} else {
			targetAnalysis = emptyAnalysis(rawUrl, renderedTarget.error || "Target failed to render");
			warnings.push("The target page could not be fetched.");
		}
	} finally {
		await session.close();
	}

	report({
		stage: "scoring",
		label: "Classifying intent, benchmarking, sourcing gaps & scoring…",
		pct: 94,
	});
	const competitorFeatures = competitors.map(c => c.features);
	const targetFeatures = extractFeatures(targetAnalysis, 0);

	// 4–7. Intent → benchmark → gaps → score
	const intent = computeIntentVerdict(keyword, competitorFeatures, targetFeatures);
	const benchmark = buildBenchmark(targetFeatures, competitorFeatures);
	const gapResult = sourceGaps(targetFeatures, competitorFeatures, intent);
	const { subScores, composite } = scorePageGap(targetFeatures, competitorFeatures, intent);

	// 8. Page-scoped site signals + PageSpeed (target only) → SOP scorecard.
	// Both are best-effort: a failure yields null and the dependent SOP rows
	// read "unknown" rather than failing, so the headline score stays stable.
	report({ stage: "scoring", label: "Checking robots/sitemap/HTTPS + PageSpeed…", pct: 96 });
	let siteSignals: SiteSignals | null = null;
	let pageSpeed: PageSpeedResult | null = null;
	if (targetAnalysis.ok) {
		const targetForSignals = targetAnalysis.finalUrl || rawUrl;
		[siteSignals, pageSpeed] = await Promise.all([
			fetchSiteSignals(targetForSignals, targetAnalysis.wordCount).catch(() => null),
			// Mobile field data: mobile-first indexing is the only model (SOP row 9).
			fetchPageSpeed(targetForSignals, { strategy: "mobile" }).catch(() => null),
		]);
	}
	const sopScorecard = evaluateSopScorecard({
		target: targetFeatures,
		targetStatus: targetAnalysis.status,
		competitors: competitors.map(c => ({ features: c.features, status: c.status })),
		keyword,
		site: siteSignals,
		psi: pageSpeed,
	});

	const target: TargetRecord = {
		url: rawUrl,
		finalUrl: targetAnalysis.finalUrl,
		domain: targetFeatures.domain,
		status: targetAnalysis.status,
		ok: targetAnalysis.ok,
		error: targetAnalysis.ok ? undefined : targetAnalysis.issues[0],
		title: targetAnalysis.title,
		metaDescription: targetAnalysis.metaDescription,
		wordCount: targetAnalysis.wordCount,
		htmlBytes: targetAnalysis.html.length,
		html: targetAnalysis.html.slice(0, MAX_STORED_HTML),
		headings: {
			h1: targetAnalysis.h1Texts,
			h2: targetAnalysis.h2Texts,
			h3: targetAnalysis.h3Texts,
		},
		links: targetAnalysis.links.slice(0, MAX_STORED_LINKS).map(l => ({ url: l.url, text: l.text, kind: l.kind })),
		schemaTypes: targetAnalysis.schemaTypes,
		features: targetFeatures,
	};

	report({ stage: "done", label: "Deducing prompts & saving report…", pct: 98 });

	const result: PageGapResult = {
		keyword,
		targetUrl: rawUrl,
		country,
		device,
		fetchedAt: new Date().toISOString(),
		score: sopScorecard.overall,
		dimensionScore: composite,
		subScores,
		sopScorecard,
		siteSignals,
		pageSpeed,
		intent,
		serp,
		benchmark,
		target,
		competitors,
		gaps: gapResult.all,
		serpValidatedGaps: gapResult.serpValidated,
		lowConfidenceGaps: gapResult.lowConfidence,
		// Filled below once the result object exists (the finder reads from it).
		promptFinder: undefined as unknown as PromptFinderResult,
		warnings,
	};
	result.promptFinder = buildPromptFinder(result);
	return result;
}
