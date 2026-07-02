/**
 * Page Gap Analyzer — net-new HTML signal extraction (deterministic).
 *
 * These are the page-level signals the SOP scorecard needs that the shared
 * audit-engine parser does not already expose. Every function here is a PURE
 * function of the captured rendered HTML / parsed analysis, so the same page
 * always yields the same signals (the project's hard consistency requirement).
 *
 * Computed for BOTH the target and every competitor (via extractFeatures), so
 * the SOP evaluator can report SERP prevalence for each check.
 */
import type { PageAnalysis } from "@/lib/audit-engine";

export type ImageSignal = {
	format: string; // jpg | png | webp | avif | svg | gif | other | ""
	modern: boolean; // webp / avif
	hasAlt: boolean;
	descriptiveName: boolean;
};

export type HtmlSignals = {
	/** First ~120 words of body text — used for opening-paragraph entity checks. */
	openingText: string;
	/** All H1/H2/H3 texts in document order (capped). */
	headingTexts: string[];
	/** Heading levels in document order, e.g. ["h1","h2","h3","h2"]. */
	headingOrder: number[];
	/** True when the hierarchy is sane: exactly one H1, no H3 before the first H2. */
	headingOrderValid: boolean;

	imagesParsed: number;
	imagesModernFormat: number;
	imagesDescriptiveName: number;

	dlCount: number;
	strongCount: number;

	/** Mixed-content references on an HTTPS page (http:// assets). */
	mixedActive: number;
	mixedPassive: number;
	mixedSamples: string[];

	hasAboutLink: boolean;
	hasContactLink: boolean;
	hasPrivacyLink: boolean;

	/** "in summary" / "bottom line" / "key takeaway" style cues. */
	summaryCues: number;
	/** `<cite>` tags + "according to / source:" style attribution cues. */
	citationCues: number;

	totalInternalAnchors: number;
	descriptiveInternalAnchors: number;

	metaRobotsNoindex: boolean;
};

const NON_DESCRIPTIVE_FILENAME =
	/^(img|image|dsc|dscn|photo|pic|picture|screenshot|screen[-_]?shot|untitled|file|upload|download|banner|logo|icon|asset|unnamed)[-_]?\d*$/i;

const NON_DESCRIPTIVE_ANCHOR = new Set([
	"click here",
	"click",
	"here",
	"read more",
	"learn more",
	"find out more",
	"more",
	"more info",
	"see more",
	"view more",
	"this",
	"link",
	"this page",
	"this link",
	"go",
	"continue",
	"details",
	"download",
]);

const SUMMARY_CUE =
	/\b(in summary|in short|bottom line|key takeaway|key takeaways|to summari[sz]e|the takeaway|tl;?dr|in a nutshell|the bottom line)\b/gi;

const CITATION_CUE =
	/\b(according to|as reported by|as per|source:|sources:|cited by|study (found|by|of)|research (shows|by|found)|data from|per a (study|report|survey))\b/gi;

const TRUST_ABOUT = /(\/about|about-us|\/team|who-we-are)/i;
const TRUST_CONTACT = /(\/contact|contact-us|\/support)/i;
const TRUST_PRIVACY = /(\/privacy|privacy-policy|\/legal|\/terms)/i;

function firstWords(text: string, n: number): string {
	return text.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

function basename(src: string): { name: string; format: string } {
	try {
		// strip query/hash, take last path segment
		const clean = src.split(/[?#]/)[0];
		const seg = clean.split("/").filter(Boolean).pop() ?? "";
		const dot = seg.lastIndexOf(".");
		const name = dot >= 0 ? seg.slice(0, dot) : seg;
		const ext = dot >= 0 ? seg.slice(dot + 1).toLowerCase() : "";
		const known = ["jpg", "jpeg", "png", "webp", "avif", "svg", "gif"];
		const format = ext === "jpeg" ? "jpg" : known.includes(ext) ? ext : ext ? "other" : "";
		return { name, format };
	} catch {
		return { name: "", format: "" };
	}
}

function isDescriptiveFilename(name: string): boolean {
	if (!name) return false;
	const decoded = decodeURIComponent(name).toLowerCase();
	if (NON_DESCRIPTIVE_FILENAME.test(decoded)) return false;
	// Needs ≥2 word-ish tokens separated by - or _, or one long meaningful word.
	const tokens = decoded.split(/[-_]+/).filter(t => /[a-z]{2,}/i.test(t));
	if (tokens.length >= 2) return true;
	return decoded.replace(/[^a-z]/gi, "").length >= 8 && !/^\d+$/.test(decoded);
}

export function parseImages(html: string): ImageSignal[] {
	const out: ImageSignal[] = [];
	const re = /<img\b[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		const tag = m[0];
		const src =
			tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ||
			tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ||
			(tag.match(/\bsrcset=["']([^"',\s]+)/i)?.[1] ?? "");
		if (/^data:/i.test(src)) continue; // inline data URI, skip
		const altMatch = tag.match(/\balt=(["'])([\s\S]*?)\1/i);
		const hasAlt = altMatch != null && altMatch[2].trim().length > 0;
		const { name, format } = basename(src);
		out.push({
			format,
			modern: format === "webp" || format === "avif",
			hasAlt,
			descriptiveName: isDescriptiveFilename(name),
		});
		if (out.length > 300) break;
	}
	return out;
}

function parseHeadingOrder(html: string): number[] {
	const order: number[] = [];
	const re = /<h([1-3])\b/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		order.push(Number(m[1]));
		if (order.length > 200) break;
	}
	return order;
}

function headingHierarchyValid(order: number[]): boolean {
	if (!order.length) return false;
	const h1s = order.filter(l => l === 1).length;
	if (h1s !== 1) return false;
	// No H3 may appear before the first H2 (a jump from H1 straight to H3).
	const firstH2 = order.indexOf(2);
	const firstH3 = order.indexOf(3);
	if (firstH3 >= 0 && (firstH2 < 0 || firstH3 < firstH2)) return false;
	return true;
}

function countMatches(text: string, re: RegExp): number {
	const m = text.match(re);
	return m ? m.length : 0;
}

export function extractHtmlSignals(a: PageAnalysis): HtmlSignals {
	const html = a.html || "";
	const text = a.text || "";
	const finalUrl = a.finalUrl || a.url || "";
	const isHttps = /^https:/i.test(finalUrl);

	const images = parseImages(html);
	const headingOrder = parseHeadingOrder(html);
	const headingTexts = [...a.h1Texts, ...a.h2Texts, ...a.h3Texts].filter(Boolean).slice(0, 40);

	// Mixed content (only meaningful on an HTTPS page).
	let mixedActive = 0;
	let mixedPassive = 0;
	const mixedSamples: string[] = [];
	if (isHttps) {
		const assetRe =
			/<(script|iframe|link|img|audio|video|source)\b[^>]*\b(?:src|href)=["'](http:\/\/[^"']+)["'][^>]*>/gi;
		let am: RegExpExecArray | null;
		while ((am = assetRe.exec(html))) {
			const tag = am[1].toLowerCase();
			const url = am[2];
			// <link> only counts as active when it loads a stylesheet/script.
			const active =
				tag === "script" ||
				tag === "iframe" ||
				(tag === "link" && /\brel=["']?(stylesheet|preload|modulepreload)/i.test(am[0]));
			if (active) mixedActive++;
			else mixedPassive++;
			if (mixedSamples.length < 5) mixedSamples.push(url);
			if (mixedActive + mixedPassive > 200) break;
		}
	}

	// Trust-page links (internal).
	let hasAboutLink = false;
	let hasContactLink = false;
	let hasPrivacyLink = false;
	let totalInternalAnchors = 0;
	let descriptiveInternalAnchors = 0;
	for (const link of a.links) {
		if (link.kind !== "internal") continue;
		let path = "";
		try {
			path = new URL(link.url).pathname;
		} catch {
			path = link.url;
		}
		if (TRUST_ABOUT.test(path)) hasAboutLink = true;
		if (TRUST_CONTACT.test(path)) hasContactLink = true;
		if (TRUST_PRIVACY.test(path)) hasPrivacyLink = true;

		totalInternalAnchors++;
		const t = link.text.trim().toLowerCase().replace(/\s+/g, " ");
		if (!t) continue;
		if (NON_DESCRIPTIVE_ANCHOR.has(t)) continue;
		if (/^https?:\/\//i.test(link.text.trim())) continue; // bare URL anchor
		const wordish = t.split(/\s+/).filter(w => /[a-z]{2,}/i.test(w));
		if (wordish.length >= 2 || t.replace(/[^a-z]/gi, "").length >= 8) descriptiveInternalAnchors++;
	}

	const metaRobotsNoindex =
		/<meta\b[^>]*\bname=["'](?:robots|googlebot)["'][^>]*\bcontent=["'][^"']*\bnoindex\b/i.test(html) ||
		/<meta\b[^>]*\bcontent=["'][^"']*\bnoindex\b[^"']*["'][^>]*\bname=["'](?:robots|googlebot)["']/i.test(html);

	return {
		openingText: firstWords(text, 120),
		headingTexts,
		headingOrder,
		headingOrderValid: headingHierarchyValid(headingOrder),
		imagesParsed: images.length,
		imagesModernFormat: images.filter(i => i.modern).length,
		imagesDescriptiveName: images.filter(i => i.descriptiveName).length,
		dlCount: countMatches(html, /<dl\b/gi),
		strongCount: countMatches(html, /<(strong|b)\b/gi),
		mixedActive,
		mixedPassive,
		mixedSamples,
		hasAboutLink,
		hasContactLink,
		hasPrivacyLink,
		summaryCues: countMatches(text, SUMMARY_CUE),
		citationCues: countMatches(html, /<cite\b/gi) + countMatches(text, CITATION_CUE),
		totalInternalAnchors,
		descriptiveInternalAnchors,
		metaRobotsNoindex,
	};
}
