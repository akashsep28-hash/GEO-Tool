/**
 * Offline PDF render smoke test. Builds a realistic report from the HTML fixture
 * (no SERP/network), renders the print HTML, and prints it to a real PDF via the
 * installed Chrome. Writes report-sample.html + report-sample.pdf for eyeballing.
 *
 * Run: npx tsx scripts/pdf-smoke.ts
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { analyzeRenderedHtml } from "@/lib/audit-engine";
import type { ExportInput } from "@/lib/page-gap-export";
import { buildBenchmark, computeIntentVerdict, extractFeatures, sourceGaps } from "@/lib/page-gap-engine";
import { buildReportHtml } from "@/lib/page-gap-report-html";
import type { PageGapResult } from "@/lib/page-gap-run";
import { evaluateSopScorecard } from "@/lib/page-gap-sop";

const URL = "https://www.example.com/personal-loan";
const KEYWORD = "personal loan";
const FIXTURE = `<!doctype html><html lang="en"><head>
<title>Personal Loan — Apply Online for Instant Approval | Example Bank</title>
<meta name="description" content="Get a personal loan from Example Bank with rates from 9.9% APR. Check eligibility and apply online in minutes.">
<link rel="canonical" href="https://www.example.com/personal-loan">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example Bank"}</script>
</head><body>
<h1>Personal Loan: Apply Online for Instant Approval</h1>
<p>A personal loan from Example Bank lets you borrow between $1,000 and $50,000 with a fixed interest rate from 9.9% APR. Funds are typically disbursed within 24 hours.</p>
<h2>What is a personal loan?</h2><p>An unsecured loan repaid over 12 to 60 months. According to a 2025 study, 38% of borrowers use them for debt consolidation.</p>
<h2>How much can you borrow?</h2><table><tr><th>Amount</th><th>APR</th></tr><tr><td>$5,000</td><td>9.9%</td></tr></table>
<ul><li>Fast approval</li><li>No prepayment penalty</li></ul>
<img src="/images/personal-loan-rates.webp" alt="rates chart"><a href="/apply">Apply now</a><a href="/about-us">About us</a>
</body></html>`;

const a = analyzeRenderedHtml(FIXTURE, URL, URL, "www.example.com", { status: 200 });
const tf = extractFeatures(a, 0);
const intent = computeIntentVerdict(KEYWORD, [], tf);
const benchmark = buildBenchmark(tf, []);
const gaps = sourceGaps(tf, [], intent);
const sop = evaluateSopScorecard({ target: tf, targetStatus: 200, competitors: [], keyword: KEYWORD, site: null, psi: null });

const report = {
	keyword: KEYWORD,
	targetUrl: URL,
	country: "us",
	device: "desktop",
	fetchedAt: new Date().toISOString(),
	score: sop.overall,
	dimensionScore: 0,
	subScores: {},
	sopScorecard: sop,
	siteSignals: null,
	pageSpeed: null,
	intent,
	serp: { results: [] },
	benchmark,
	target: {
		url: URL,
		finalUrl: URL,
		domain: "example.com",
		status: 200,
		ok: true,
		title: tf.title,
		metaDescription: tf.metaDescription,
		wordCount: a.wordCount,
		htmlBytes: FIXTURE.length,
		html: FIXTURE,
		headings: { h1: a.h1Texts, h2: a.h2Texts, h3: a.h3Texts },
		links: [],
		schemaTypes: tf.schemaTypes,
		features: tf,
	},
	competitors: [],
	gaps: gaps.all,
	serpValidatedGaps: gaps.serpValidated,
	lowConfidenceGaps: gaps.lowConfidence,
	promptFinder: undefined,
	warnings: [],
} as unknown as PageGapResult;

const input: ExportInput = { report, llm: null, schema: null };
const html = buildReportHtml(input);
writeFileSync("report-sample.html", html);

(async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage();
	await page.setContent(html, { waitUntil: "networkidle" });
	const pdf = await page.pdf({
		format: "A4",
		printBackground: true,
		margin: { top: "14mm", bottom: "16mm", left: "13mm", right: "13mm" },
	});
	writeFileSync("report-sample.pdf", pdf);
	await browser.close();
	const head = Buffer.from(pdf.slice(0, 5)).toString("latin1");
	console.log(`PDF: ${pdf.length} bytes, header "${head}" → ${head === "%PDF-" ? "✅ valid PDF" : "❌ NOT a PDF"}`);
	console.log("Wrote report-sample.html + report-sample.pdf");
})();
