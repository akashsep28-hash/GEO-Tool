/**
 * PageSpeed Insights (PSI v5) client for the Page Gap Analyzer.
 *
 * The SOP's Core-Web-Vitals rows (LCP / INP / CLS) and the JS/CSS/caching row
 * are scored from PSI. We deliberately prefer **CrUX field data** (28-day
 * real-user aggregate, p75) over Lighthouse lab timings: field data is stable
 * day to day, so it does not make the same-URL score flip-flop. Lab data is
 * used only for the structural opportunity audits (render-blocking, minify,
 * compression, caching, viewport) which are essentially deterministic.
 *
 * The API key is read from PAGESPEED_API_KEY (env). PSI works without a key at
 * low volume, so a missing key degrades gracefully rather than hard-failing.
 * Any failure returns `fetched:false` and the dependent SOP rows read
 * "unknown" (excluded from the score denominator) instead of failing — so a
 * flaky network call can never swing the headline number.
 */
import "server-only";

export type CruxCategory = "FAST" | "AVERAGE" | "SLOW" | "NONE";

export type CruxMetric = {
	/** p75 value: ms for LCP/INP, unitless for CLS. */
	p75: number;
	category: CruxCategory;
} | null;

export type LabAudit = {
	score: number | null; // 0–1
	title: string;
	displayValue?: string;
};

export type PageSpeedResult = {
	strategy: "mobile" | "desktop";
	fetched: boolean;
	error?: string;
	/** CrUX real-user field data (preferred, stable). */
	field: {
		source: "url" | "origin" | null;
		lcpMs: CruxMetric;
		inpMs: CruxMetric;
		cls: CruxMetric;
	};
	/** Lighthouse lab data (used only for structural opportunity audits). */
	lab: {
		performanceScore: number | null; // 0–100
		audits: Record<string, LabAudit>;
	} | null;
};

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

const LAB_AUDITS = [
	"render-blocking-resources",
	"unminified-css",
	"unminified-javascript",
	"uses-text-compression",
	"uses-long-cache-ttl",
	"viewport",
	"largest-contentful-paint",
	"cumulative-layout-shift",
];

function emptyResult(strategy: "mobile" | "desktop", error?: string): PageSpeedResult {
	return {
		strategy,
		fetched: false,
		error,
		field: { source: null, lcpMs: null, inpMs: null, cls: null },
		lab: null,
	};
}

type PsiMetric = { percentile?: number; category?: string };

function toMetric(m: PsiMetric | undefined, divisor = 1): CruxMetric {
	if (!m || typeof m.percentile !== "number") return null;
	const cat = (m.category as CruxCategory) || "NONE";
	return { p75: m.percentile / divisor, category: cat };
}

/**
 * Fetch PSI for a URL. Never throws. `strategy` defaults to mobile (mobile-first
 * indexing is the only model since July 2024 per the SOP).
 */
export async function fetchPageSpeed(
	url: string,
	opts: { strategy?: "mobile" | "desktop"; timeoutMs?: number } = {},
): Promise<PageSpeedResult> {
	const strategy = opts.strategy ?? "mobile";
	const key = process.env.PAGESPEED_API_KEY?.trim();

	const params = new URLSearchParams({ url, strategy, category: "performance" });
	if (key) params.set("key", key);

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
	try {
		const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
			signal: ctrl.signal,
			headers: { Accept: "application/json" },
		});
		if (!res.ok) {
			return emptyResult(strategy, `PSI HTTP ${res.status}`);
		}
		const data = (await res.json()) as Record<string, unknown>;

		// CrUX field data — prefer URL-level, fall back to origin-level.
		const urlExp = data.loadingExperience as { metrics?: Record<string, PsiMetric> } | undefined;
		const originExp = data.originLoadingExperience as { metrics?: Record<string, PsiMetric> } | undefined;
		const urlMetrics = urlExp?.metrics ?? {};
		const hasUrlField = Object.keys(urlMetrics).length > 0;
		const metrics = hasUrlField ? urlMetrics : (originExp?.metrics ?? {});
		const source: "url" | "origin" | null = hasUrlField
			? "url"
			: Object.keys(originExp?.metrics ?? {}).length > 0
				? "origin"
				: null;

		const field = {
			source,
			lcpMs: toMetric(metrics.LARGEST_CONTENTFUL_PAINT_MS),
			inpMs: toMetric(metrics.INTERACTION_TO_NEXT_PAINT),
			// CrUX reports CLS percentile as the score × 100 (e.g. 10 → 0.10).
			cls: toMetric(metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE, 100),
		};

		// Lighthouse lab data (structural audits only).
		const lh = data.lighthouseResult as
			| { categories?: { performance?: { score?: number } }; audits?: Record<string, Record<string, unknown>> }
			| undefined;
		let lab: PageSpeedResult["lab"] = null;
		if (lh) {
			const audits: Record<string, LabAudit> = {};
			for (const id of LAB_AUDITS) {
				const a = lh.audits?.[id];
				if (!a) continue;
				audits[id] = {
					score: typeof a.score === "number" ? (a.score as number) : null,
					title: (a.title as string) ?? id,
					displayValue: (a.displayValue as string) ?? undefined,
				};
			}
			const perf = lh.categories?.performance?.score;
			lab = {
				performanceScore: typeof perf === "number" ? Math.round(perf * 100) : null,
				audits,
			};
		}

		return { strategy, fetched: true, field, lab };
	} catch (e) {
		return emptyResult(strategy, (e as Error).name === "AbortError" ? "PSI timed out" : (e as Error).message);
	} finally {
		clearTimeout(timer);
	}
}
