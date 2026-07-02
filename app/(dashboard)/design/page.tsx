import { FeatureGate } from "@/components/FeatureGate";
import { connectedProviderIds } from "@/lib/connections";

export default async function DesignPage() {
	const connected = await connectedProviderIds();
	const hasCms = ["wordpress", "webflow"].some(p => connected.has(p));

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Design Studio</h1>
				<p className="text-[var(--color-muted)]">
					Generate on-brand pages and assets that are formatted for machine extraction — clean HTML, schema-ready
					blocks, answer-first sections.
				</p>
			</div>

			<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{[
					["Answer-first section blocks", "Hero + quick-answer blocks the engines can lift as a single chunk."],
					["Comparison table builder", "The strongest recovery lever post-Gemini 3 (+34% in 14 days)."],
					["Schema-ready layouts", "Sections that map to Organization, Article, FAQ, HowTo, Product."],
					["llms.txt generator", "Auto-build a curated crawler map from your sitemap."],
					["Brand entity kit", "Consistent names, titles, descriptions for cross-domain consistency."],
					["Export to CMS", "Push finished pages straight to WordPress / Webflow."],
				].map(([t, d]) => (
					<div key={t} className="card p-5">
						<div className="font-semibold">{t}</div>
						<div className="text-sm text-[var(--color-muted)] mt-1">{d}</div>
					</div>
				))}
			</div>

			{!hasCms && (
				<FeatureGate title="Direct publishing" providers={["WordPress", "Webflow"]}>
					<p className="text-sm text-[var(--color-muted)] mt-1">
						You can still generate and copy designs without a CMS connected.
					</p>
				</FeatureGate>
			)}

			<div className="card p-6 text-sm text-[var(--color-muted)]">
				The generative page/asset builder is the next module to wire up in this section. The data model, AI layer,
				and CMS connections it needs are already in place — content generation runs through the same Claude engine
				used by the Blog Writer.
			</div>
		</div>
	);
}
