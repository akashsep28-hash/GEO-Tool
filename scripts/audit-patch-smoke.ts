/**
 * Offline smoke test for the Website Auditor's deterministic layers:
 * lib/html-patch.ts (patch engine + gating heuristics + grounding gate).
 * Run: npx tsx --tsconfig tsconfig.smoke.json scripts/audit-patch-smoke.ts
 * No model, no network — everything asserted here must be deterministic.
 */
import {
	addAltPlaceholders,
	appendFaqSection,
	ensureCanonical,
	ensureLang,
	ensureOgTags,
	ensureScaffold,
	escapeHtml,
	injectAnswerFirstIntro,
	injectJsonLd,
	isGroundedProse,
	looksAnswerFirst,
	setMetaDescription,
	setTitle,
} from "../lib/html-patch";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
	if (ok) console.log(`  PASS  ${name}`);
	else {
		failures++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

const FIXTURE = `<!doctype html>
<html>
<head>
<title>Old title</title>
</head>
<body>
<main>
<h1>Personal Loan EMI Calculator</h1>
<p>Welcome to our website. We are passionate about helping you.</p>
<p>A personal loan EMI calculator computes your monthly instalment from the loan amount, interest rate of 11.5% and tenure up to 60 months.</p>
<img src="/img/calculator-screenshot.png">
<img src="/img/team.jpg" alt="Our team">
</main>
</body>
</html>`;

console.log("— scaffold + head patches —");
{
	const scaffolded = ensureScaffold("<p>bare fragment</p>");
	check("ensureScaffold wraps fragments", /<html>/.test(scaffolded) && /<head>/.test(scaffolded));

	const t = setTitle(FIXTURE, 'Personal Loan EMI Calculator <2026> & "Rates"');
	check("setTitle replaces existing title", t.applied && /<title>Personal Loan EMI Calculator/.test(t.html));
	check("setTitle escapes html", t.html.includes("&lt;2026&gt;") && t.html.includes("&quot;Rates&quot;"));
	check("setTitle drops the old title", !t.html.includes("Old title"));

	const m = setMetaDescription(FIXTURE, "Compute your personal loan EMI from amount, rate and tenure.");
	check("setMetaDescription inserts when missing", m.applied && /<meta name="description"/.test(m.html));

	const c = ensureCanonical(FIXTURE, "https://example.com/emi-calculator");
	check("ensureCanonical inserts", c.applied && /rel="canonical" href="https:\/\/example.com\/emi-calculator"/.test(c.html));
	const c2 = ensureCanonical(c.html, "https://example.com/other");
	check("ensureCanonical never overrides", !c2.applied && !c2.html.includes("/other"));

	const l = ensureLang(FIXTURE);
	check("ensureLang adds lang", l.applied && /<html lang="en">/.test(l.html));
	check("ensureLang idempotent", !ensureLang(l.html).applied);

	const og = ensureOgTags(FIXTURE, { title: "T", description: "D", url: "https://example.com/x" });
	check(
		"ensureOgTags adds all four",
		og.applied &&
			/og:title/.test(og.html) &&
			/og:description/.test(og.html) &&
			/og:url/.test(og.html) &&
			/og:type/.test(og.html),
	);
}

console.log("— body patches —");
{
	const alt = addAltPlaceholders(FIXTURE);
	check("alt placeholders only on images without alt", alt.count === 1, `count=${alt.count}`);
	check("alt placeholder names the file", alt.html.includes('alt="[DESCRIBE: calculator-screenshot.png]"'));
	check("existing alt untouched", alt.html.includes('alt="Our team"'));

	const intro = injectAnswerFirstIntro(FIXTURE, "A personal loan EMI calculator shows your exact monthly payment.");
	check("intro lands right after </h1>", /<\/h1>\n<p>A personal loan EMI calculator/.test(intro.html));

	const faq = appendFaqSection(FIXTURE, [
		{ question: "What is an EMI?", answer: "Your fixed monthly payment." },
		{ question: "How is it computed?", answer: "From amount, rate and tenure." },
	]);
	check("FAQ section appended inside <main>", /<section id="faq">[\s\S]*<\/section>\s*<\/main>/.test(faq.html));
	check("FAQ keeps original content intact", faq.html.includes("interest rate of 11.5%"));

	const ld = injectJsonLd(FIXTURE, [{ "@type": "WebPage", name: "x</script>y" }]);
	check("JSON-LD script injected", ld.applied && /application\/ld\+json/.test(ld.html));
	check("JSON-LD escapes </script>", !/x<\/script>y/.test(ld.html) && ld.html.includes("\\u003c/script>"));
}

console.log("— gating heuristics —");
{
	check("marketing opener is NOT answer-first", !looksAnswerFirst("Welcome to our website. We are passionate."));
	check(
		"direct answer IS answer-first",
		looksAnswerFirst("A personal loan EMI calculator computes your monthly instalment from amount, rate and tenure."),
	);
	check("empty text is not answer-first", !looksAnswerFirst(""));
}

console.log("— grounding gate —");
{
	const corpus = "The loan carries an interest rate of 11.5% for a tenure up to 60 months on amounts to 5 lakh.";
	check("grounded synthesis passes", isGroundedProse("Interest rate is 11.5% with tenure up to 60 months.", corpus));
	check(
		"invented figure is rejected",
		!isGroundedProse("Interest rate is 9.99% with tenure up to 60 months.", corpus),
		"9.99 not in corpus",
	);
	check("off-topic text is rejected", !isGroundedProse("Our pizza dough recipe uses fresh basil and mozzarella.", corpus));
}

console.log("— escaping —");
check("escapeHtml", escapeHtml('<a href="x">&</a>') === "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");

if (failures) {
	console.error(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log("\nAll checks passed.");
