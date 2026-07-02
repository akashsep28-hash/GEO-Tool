/**
 * Offline consistency + sanity check for the SOP scorecard.
 *
 * Verifies the project's hard requirement: the same page yields the SAME
 * scorecard every time. Parses one fixed HTML fixture twice, evaluates the SOP
 * scorecard twice (site/psi = null, i.e. the fully deterministic HTML-derived
 * subset), and asserts the two JSON outputs are byte-identical. Also prints the
 * per-item result so the algorithms can be eyeballed for accuracy.
 *
 * Run: npx tsx scripts/sop-consistency.ts
 */
import { analyzeRenderedHtml } from "@/lib/audit-engine";
import { extractFeatures } from "@/lib/page-gap-engine";
import { evaluateSopScorecard } from "@/lib/page-gap-sop";

const URL = "https://www.example.com/personal-loan";
const KEYWORD = "personal loan";

const FIXTURE = `<!doctype html>
<html lang="en">
<head>
<title>Personal Loan — Apply Online for Instant Approval | Example Bank</title>
<meta name="description" content="Get a personal loan from Example Bank with rates from 9.9% APR. Check your eligibility and apply online in minutes.">
<link rel="canonical" href="https://www.example.com/personal-loan">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="Personal Loan | Example Bank">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example Bank"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>
</head>
<body>
<h1>Personal Loan: Apply Online for Instant Approval</h1>
<p>A personal loan from Example Bank lets you borrow between $1,000 and $50,000 with a fixed interest rate from 9.9% APR. Funds are typically disbursed within 24 hours of approval.</p>
<h2>What is a personal loan?</h2>
<p>A personal loan is an unsecured loan you repay in fixed monthly instalments over 12 to 60 months. According to a 2025 industry study, 38% of borrowers use them for debt consolidation.</p>
<h2>How much can you borrow?</h2>
<table><tr><th>Loan amount</th><th>APR</th></tr><tr><td>$5,000</td><td>9.9%</td></tr></table>
<ul><li>Fast approval</li><li>No prepayment penalty</li><li>Fixed monthly payments</li></ul>
<h3>Eligibility</h3>
<p>You must be 21+ with a steady income. In summary: most salaried applicants qualify.</p>
<img src="/images/personal-loan-rates.webp" alt="Personal loan rates chart">
<img src="/img/IMG_2043.jpg">
<a href="/apply">Apply now</a>
<a href="/about-us">About us</a>
<a href="/blog/loan-tips">Read our personal loan tips guide</a>
<a href="/contact">click here</a>
<button>Check your eligibility</button>
</body>
</html>`;

function evalOnce() {
	const a = analyzeRenderedHtml(FIXTURE, URL, URL, "www.example.com", { status: 200 });
	const features = extractFeatures(a, 0);
	return evaluateSopScorecard({
		target: features,
		targetStatus: 200,
		competitors: [],
		keyword: KEYWORD,
		site: null,
		psi: null,
	});
}

const a = evalOnce();
const b = evalOnce();

const sa = JSON.stringify(a);
const sb = JSON.stringify(b);

console.log(`\nOverall: ${a.overall}/100  (scored weight ${a.scoredWeight})`);
for (const cat of a.categories) {
	console.log(`\n■ ${cat.label}: ${cat.score}/100`);
	for (const it of cat.items) {
		const flag = it.status === "pass" ? "✓" : it.status === "partial" ? "~" : it.status === "fail" ? "✗" : "·";
		console.log(`  ${flag} [${it.status.padEnd(13)}] r${it.sopRow} w${it.weight} — ${it.title}`);
		console.log(`      ${it.detail}`);
	}
}

if (sa === sb) {
	console.log("\n✅ CONSISTENCY: identical output across two runs.");
} else {
	console.error("\n❌ CONSISTENCY FAILED: output differs across runs.");
	process.exit(1);
}
