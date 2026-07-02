/**
 * Deterministic HTML patching for the Website Auditor's "corrected version".
 *
 * The old design asked the LLM to re-emit the ENTIRE page HTML — the single
 * least reliable thing a small model can do (truncation, dropped content,
 * invented copy, broken markup). This module replaces that with algorithmic
 * string surgery on the ORIGINAL html: every byte of the brand's real content
 * is preserved by construction, and the model only ever supplies small text
 * values (a title, a meta description, an intro paragraph, FAQ answers) that
 * are escaped and inserted at deterministic points.
 *
 * All functions are pure and side-effect free. Each returns the patched html
 * plus whether it changed anything, so the pipeline can report exactly which
 * patches were applied.
 */

export type PatchResult = { html: string; applied: boolean };

export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Guarantee the document has <html>, <head> and <body> containers to patch into. */
export function ensureScaffold(html: string): string {
	let out = html;
	if (!/<html[\s>]/i.test(out)) out = `<html>\n${out}\n</html>`;
	if (!/<head[\s>]/i.test(out)) out = out.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n</head>`);
	if (!/<body[\s>]/i.test(out)) {
		// Everything after </head> becomes the body.
		out = out.replace(/(<\/head>)([\s\S]*)(<\/html>)/i, `$1\n<body>$2</body>\n$3`);
	}
	return out;
}

function insertInHead(html: string, fragment: string): string {
	if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${fragment}\n</head>`);
	if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>\n${fragment}`);
	return `${fragment}\n${html}`;
}

/** Replace the <title> text, or insert one when missing. */
export function setTitle(html: string, title: string): PatchResult {
	const esc = escapeHtml(title.trim());
	if (!esc) return { html, applied: false };
	if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
		const next = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${esc}</title>`);
		return { html: next, applied: next !== html };
	}
	return { html: insertInHead(html, `<title>${esc}</title>`), applied: true };
}

/** Replace the meta description content, or insert the tag when missing. */
export function setMetaDescription(html: string, description: string): PatchResult {
	const esc = escapeHtml(description.trim());
	if (!esc) return { html, applied: false };
	const re = /<meta\s+[^>]*name=["']description["'][^>]*>/i;
	const tag = `<meta name="description" content="${esc}">`;
	if (re.test(html)) {
		const next = html.replace(re, tag);
		return { html: next, applied: next !== html };
	}
	return { html: insertInHead(html, tag), applied: true };
}

/** Insert a canonical link when none exists (never overrides an existing one). */
export function ensureCanonical(html: string, url: string): PatchResult {
	if (/<link\s+[^>]*rel=["']canonical["']/i.test(html)) return { html, applied: false };
	const esc = escapeHtml(url.trim());
	if (!esc) return { html, applied: false };
	return { html: insertInHead(html, `<link rel="canonical" href="${esc}">`), applied: true };
}

/** Set the lang attribute on <html> when missing. */
export function ensureLang(html: string, lang = "en"): PatchResult {
	const m = html.match(/<html([^>]*)>/i);
	if (!m) return { html, applied: false };
	if (/\blang\s*=/i.test(m[1])) return { html, applied: false };
	const next = html.replace(/<html([^>]*)>/i, `<html$1 lang="${escapeHtml(lang)}">`);
	return { html: next, applied: true };
}

/** Add any missing Open Graph tags (og:title / og:description / og:url / og:type). */
export function ensureOgTags(
	html: string,
	og: { title: string; description: string; url: string; type?: string },
): PatchResult {
	const tags: string[] = [];
	const has = (prop: string) => new RegExp(`<meta\\s+[^>]*property=["']og:${prop}["']`, "i").test(html);
	if (og.title && !has("title")) tags.push(`<meta property="og:title" content="${escapeHtml(og.title)}">`);
	if (og.description && !has("description"))
		tags.push(`<meta property="og:description" content="${escapeHtml(og.description)}">`);
	if (og.url && !has("url")) tags.push(`<meta property="og:url" content="${escapeHtml(og.url)}">`);
	if (!has("type")) tags.push(`<meta property="og:type" content="${escapeHtml(og.type ?? "website")}">`);
	if (!tags.length) return { html, applied: false };
	return { html: insertInHead(html, tags.join("\n")), applied: true };
}

/**
 * Give every <img> without alt text a clearly-marked placeholder alt so the
 * publisher fills in the real description ([DESCRIBE: filename] — never an
 * invented caption). Returns how many images were patched.
 */
export function addAltPlaceholders(html: string): PatchResult & { count: number } {
	let count = 0;
	const next = html.replace(/<img\b[^>]*?>/gi, tag => {
		if (/\balt\s*=/i.test(tag)) return tag;
		const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
		const file = src.split("/").pop()?.split("?")[0] ?? "image";
		count++;
		return tag.replace(/<img/i, `<img alt="[DESCRIBE: ${escapeHtml(file)}]"`);
	});
	return { html: next, applied: count > 0, count };
}

/** Inject a JSON-LD script (already-assembled objects) before </head>. */
export function injectJsonLd(html: string, objects: unknown[]): PatchResult {
	if (!objects.length) return { html, applied: false };
	// HTML-safe: escape "<" inside the JSON so a "</script>" in any string value
	// cannot terminate the script tag early.
	const json = JSON.stringify(objects.length === 1 ? objects[0] : objects, null, 2).replace(/</g, "\\u003c");
	const script = `<script type="application/ld+json">\n${json}\n</script>`;
	return { html: insertInHead(html, script), applied: true };
}

/**
 * Insert an answer-first intro paragraph immediately after the first </h1>
 * (falling back to the top of <main>, then <body>). The paragraph text comes
 * from the grounded intro-writer agent; it is escaped here.
 */
export function injectAnswerFirstIntro(html: string, paragraph: string): PatchResult {
	const esc = escapeHtml(paragraph.trim());
	if (!esc) return { html, applied: false };
	const p = `\n<p>${esc}</p>`;
	if (/<\/h1>/i.test(html)) return { html: html.replace(/<\/h1>/i, `</h1>${p}`), applied: true };
	if (/<main[^>]*>/i.test(html)) return { html: html.replace(/<main([^>]*)>/i, `<main$1>${p}`), applied: true };
	if (/<body[^>]*>/i.test(html)) return { html: html.replace(/<body([^>]*)>/i, `<body$1>${p}`), applied: true };
	return { html, applied: false };
}

/**
 * Append a visible FAQ section (question-style H3s under one H2) before
 * </main>/</footer>/</body>. Only called with GROUNDED Q&A — either lifted
 * verbatim from the page or drafted from the page's own text and verified.
 */
export function appendFaqSection(html: string, faqs: { question: string; answer: string }[]): PatchResult {
	if (!faqs.length) return { html, applied: false };
	const items = faqs.map(f => `<h3>${escapeHtml(f.question)}</h3>\n<p>${escapeHtml(f.answer)}</p>`).join("\n");
	const section = `\n<section id="faq">\n<h2>Frequently asked questions</h2>\n${items}\n</section>\n`;
	if (/<\/main>/i.test(html)) return { html: html.replace(/<\/main>/i, `${section}</main>`), applied: true };
	if (/<footer[\s>]/i.test(html))
		return { html: html.replace(/<footer([\s>])/i, `${section}<footer$1`), applied: true };
	if (/<\/body>/i.test(html)) return { html: html.replace(/<\/body>/i, `${section}</body>`), applied: true };
	return { html: `${html}${section}`, applied: true };
}

// ---------------------------------------------------------------------------
// Deterministic content heuristics used to GATE the AI micro-agents — when a
// heuristic says the page is fine, no model call happens at all.
// ---------------------------------------------------------------------------

const MARKETING_OPENERS =
	/^(welcome to|we are|we're|at [a-z]|looking for|discover|founded in|our (mission|team|company)|since \d{4})/i;

/**
 * Does the page open answer-first? True when the readable text starts with a
 * reasonably short first sentence that isn't a marketing opener — the pattern
 * answer engines can lift directly.
 */
export function looksAnswerFirst(text: string): boolean {
	const t = text.trim().replace(/\s+/g, " ");
	if (!t) return false;
	const firstSentence = t.match(/^[^.!?]{10,240}[.!?]/)?.[0] ?? "";
	if (!firstSentence) return false;
	if (MARKETING_OPENERS.test(firstSentence)) return false;
	const words = firstSentence.split(/\s+/).length;
	return words >= 6 && words <= 40;
}

/** Digit groups (commas stripped) — used to reject AI text containing figures not on the page. */
export function numberTokens(s: string): Set<string> {
	const out = new Set<string>();
	for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(m[0].replace(/,/g, ""));
	return out;
}

const STOP = new Set(
	"the a an and or but of to in on for with at by from as is are was were be been it its this that these those you your we our".split(
		" ",
	),
);

export function significantTokens(s: string): string[] {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(w => w.length > 2 && !STOP.has(w));
}

/**
 * Grounding gate for AI-drafted prose: every figure must appear in the source
 * corpus, and the wording must lexically overlap it enough to actually be
 * about this page (synthesis allowed, invention not).
 */
export function isGroundedProse(answer: string, corpus: string, minOverlap = 0.4): boolean {
	const aTokens = significantTokens(answer);
	if (aTokens.length < 3) return false;
	const corpusNumbers = numberTokens(corpus);
	for (const n of numberTokens(answer)) if (!corpusNumbers.has(n)) return false;
	const page = new Set(significantTokens(corpus));
	const hits = aTokens.filter(w => page.has(w)).length;
	return hits / aTokens.length >= minOverlap;
}
