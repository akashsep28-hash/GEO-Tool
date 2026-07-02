/**
 * Page Gap — Target Artifacts derivation (pure, client-safe; NO server-only).
 *
 * buildUniqueItems() powers the "Unique items across all pages" artifact: the
 * concrete features the ranking pages ship that the target page lacks and would
 * benefit from. It is a deterministic diff of the benchmark (target = rank 0)
 * against the competitor rows — no LLM, no fetch.
 */
import type { BenchmarkRow } from "@/lib/page-gap-engine";
import type { PageGapResult } from "@/lib/page-gap-run";

export type UniqueItem = {
	item: string;
	/** Ranking pages that have this item, e.g. "#2 nerdwallet.com". */
	presentOn: string[];
	note: string;
};

type FlagCheck = {
	key: keyof BenchmarkRow;
	item: string;
	note: string;
};

// Boolean benchmark signals worth pursuing if the target lacks them.
const FLAG_CHECKS: FlagCheck[] = [
	{
		key: "has_faq",
		item: "FAQ section",
		note: "Answers common questions inline — strong for AI Overviews & FAQ schema.",
	},
	{
		key: "has_table",
		item: "Comparison / data table",
		note: "Structured, extractable data that answer engines lift directly.",
	},
	{
		key: "has_calculator",
		item: "Interactive calculator / tool",
		note: "Utility that earns dwell time and links; hard for text-only pages to match.",
	},
	{
		key: "has_inline_cta",
		item: "Inline call-to-action",
		note: "Converts in-context readers without forcing a scroll.",
	},
	{
		key: "has_sticky_cta",
		item: "Sticky / persistent CTA",
		note: "Keeps the conversion path visible through long content.",
	},
	{
		key: "has_named_author",
		item: "Named author / byline",
		note: "E-E-A-T author attribution that ranking pages use.",
	},
	{
		key: "has_updated_date",
		item: "Visible 'last updated' date",
		note: "Freshness signal for both Google and AI citation.",
	},
	{
		key: "internal_link_to_service",
		item: "Internal link to a service / money page",
		note: "Passes relevance and routes intent to the converting page.",
	},
	{
		key: "geo_answer_first",
		item: "Answer-first opening passage",
		note: "A direct answer up top is what AI engines quote.",
	},
	{
		key: "geo_summary_table",
		item: "Summary 'key facts' table",
		note: "At-a-glance summary block that engines extract as a snippet.",
	},
	{ key: "faq_schema", item: "FAQPage structured data", note: "Marks up Q&A for richer LLM/answer-engine pickup." },
	{
		key: "breadcrumb_schema",
		item: "BreadcrumbList structured data",
		note: "Navigation context + breadcrumb rich result.",
	},
];

function label(b: BenchmarkRow): string {
	return `#${b.rank} ${b.domain}`;
}

export function buildUniqueItems(report: PageGapResult): UniqueItem[] {
	const target = report.benchmark.find(b => b.rank === 0);
	const competitors = report.benchmark.filter(b => b.rank > 0);
	if (!target || competitors.length === 0) return [];

	const items: UniqueItem[] = [];

	for (const c of FLAG_CHECKS) {
		if (target[c.key]) continue; // target already has it
		const have = competitors.filter(b => Boolean(b[c.key]));
		if (have.length === 0) continue;
		items.push({ item: c.item, presentOn: have.map(label), note: c.note });
	}

	// Schema types present on competitors but missing from the target.
	const targetSchema = new Set(target.schema_types.map(s => s.toLowerCase()));
	const schemaSeen = new Map<string, string[]>();
	for (const b of competitors) {
		for (const raw of b.schema_types) {
			const key = raw.toLowerCase();
			if (targetSchema.has(key)) continue;
			const list = schemaSeen.get(raw) ?? [];
			if (!list.includes(label(b))) list.push(label(b));
			schemaSeen.set(raw, list);
		}
	}
	for (const [type, on] of schemaSeen) {
		items.push({
			item: `${type} schema`,
			presentOn: on,
			note: "Structured-data type used by ranking pages that the target does not declare.",
		});
	}

	// Most-corroborated opportunities first.
	return items.sort((a, b) => b.presentOn.length - a.presentOn.length);
}
