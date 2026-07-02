/**
 * Offline smoke for industry-specific schema vocab + schema-set wiring.
 *
 * Reproduces the DMI "emergency personal loan" blog case: a blog_guide page in
 * the lending industry whose existing JSON-LD has NO finance type, but whose
 * sourced gap findings recommend LoanOrCredit. Asserts that:
 *   1. buildSchemaPlan now PLANS LoanOrCredit (schema set takes input from the
 *      sourced gap findings), and
 *   2. buildGraph EMITS a LoanOrCredit node from the registry spec (generic
 *      builder), with safe deterministic props filled and the page-fact props
 *      (APR/amount/term) routed to recommendations — never fabricated.
 *
 * Run: npx tsx scripts/schema-industry-smoke.ts
 */
import { buildGraph, buildSchemaPlan, type ContentPack, extractExistingJsonLd } from "@/lib/page-gap-schema";
import type { PageGapResult } from "@/lib/page-gap-run";

const URL = "https://www.dmifinance.in/personal-loan/emergency-personal-loan/";

// Existing on-page JSON-LD: Article + WebPage + FAQ — NO finance type (the blog case).
const EXISTING_HTML = `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","@id":"${URL}#article","headline":"Emergency Personal Loan"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","@id":"${URL}","url":"${URL}","name":"Emergency Personal Loan in India"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","@id":"${URL}#faqpage","mainEntity":[{"@type":"Question","name":"What is an emergency personal loan?","acceptedAnswer":{"@type":"Answer","text":"A fast unsecured loan for urgent expenses."}}]}</script>`;

// Minimal report — only the fields buildSchemaPlan / buildGraph read.
const report = {
	targetUrl: URL,
	keyword: "emergency personal loan",
	country: "in",
	target: {
		finalUrl: URL,
		title: "Emergency Personal Loan in India | Apply Now for Urgent Funds",
		domain: "dmifinance.in",
		metaDescription: "Get an emergency personal loan with DMI Finance. Fast approval, easy EMIs, 100% digital.",
		html: EXISTING_HTML,
		features: {
			h1Text: "Emergency Personal Loan: Get Urgent Funds In a Crisis",
			title: "Emergency Personal Loan in India",
			domain: "dmifinance.in",
			faqQuestions: ["What is an emergency personal loan?"],
			hasFaq: true,
		},
	},
	intent: { targetPageType: "blog_guide" },
	promptFinder: { industry: "Lending & credit (finance)", topic: "Personal Loan" },
	benchmark: [
		{ rank: 1, domain: "a.com", schema_types: ["Article", "FAQPage"], faq_schema: true, breadcrumb_schema: true },
		{ rank: 2, domain: "b.com", schema_types: ["Article", "FAQPage"], faq_schema: true, breadcrumb_schema: true },
		{ rank: 3, domain: "c.com", schema_types: ["Article"], faq_schema: false, breadcrumb_schema: false },
	],
	gaps: [
		{
			id: "intent.hybrid_missing_schema",
			category: "intent",
			dimension: "conversion",
			severity: "high",
			title: "Hybrid intent but no commercial/FAQ schema",
			recommended_action: "Add Product, Service, LoanOrCredit, or FAQPage JSON-LD as relevant.",
		},
	],
} as unknown as PageGapResult;

// Deterministic content pack (no AI) — descriptions present, no page-fact rates.
const pack: ContentPack = {
	metaDescription: report.target.metaDescription,
	organizationDescription: "DMI Finance is an RBI-registered NBFC offering digital personal loans.",
	primaryDescription: "An emergency personal loan is a fast, unsecured loan for urgent expenses.",
	author: "",
	datePublished: "",
	dateModified: "",
	faqs: [{ question: "What is an emergency personal loan?", answer: "A fast unsecured loan for urgent expenses." }],
	schemaAudit: [],
};

const existing = extractExistingJsonLd(report.target.html);
const plan = buildSchemaPlan(report, existing);
const { objects, genericRecommendations } = buildGraph(report, plan, pack, existing);

const typeOf = (o: unknown) => (o as { "@type"?: string })["@type"];
const planned = plan.added.includes("LoanOrCredit");
const loan = objects.find(o => typeOf(o) === "LoanOrCredit") as Record<string, unknown> | undefined;
const aprRec = genericRecommendations.find(r => r.type === "LoanOrCredit" && r.field === "annualPercentageRate");

console.log("plan.added:", plan.added.join(", "));
console.log("LoanOrCredit planned:", planned);
console.log("LoanOrCredit node emitted:", !!loan);
if (loan) console.log("  node:", JSON.stringify(loan));
console.log("APR routed to recommendation (not fabricated):", !!aprRec);
console.log("# generic recommendations:", genericRecommendations.length);

const ok =
	planned &&
	!!loan &&
	(loan.provider as { "@id"?: string })?.["@id"]?.includes("#organization") &&
	loan.loanType === "Personal Loan" &&
	!("annualPercentageRate" in loan) && // never fabricated
	!!aprRec;

console.log(ok ? "\nSMOKE PASS ✓" : "\nSMOKE FAIL ✗");
process.exit(ok ? 0 : 1);
