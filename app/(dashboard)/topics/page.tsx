import Link from "next/link";
import { aiAvailability } from "@/lib/ai";
import { connectedProviderIds } from "@/lib/connections";
import { createClient } from "@/lib/supabase/server";
import { GenerateTopics } from "./TopicsClient";

export default async function TopicsPage() {
	const supabase = await createClient();
	const { data: topics } = await supabase
		.from("topics")
		.select("id, title, cluster, win_condition, score, rationale, status")
		.order("score", { ascending: false })
		.limit(50);

	const ai = await aiAvailability();
	const connected = await connectedProviderIds();
	const hasDataApis = ["semrush", "ahrefs", "serpapi", "dataforseo"].some(p => connected.has(p));

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold">Topic Clustering &amp; Prompt Research</h1>
					<p className="text-[var(--color-muted)]">
						Prioritised by buyer value and winnability — not volume. Each idea is tagged with its win condition
						(mention vs citation).
					</p>
				</div>
				<GenerateTopics disabled={!ai.available} />
			</div>

			{!ai.available && (
				<div className="card p-4 border-[var(--color-warning)]/40 text-sm text-[var(--color-warning)]">
					Connect an AI model (Anthropic/Claude) in Settings, or set ANTHROPIC_API_KEY, to generate topics.
				</div>
			)}

			<div className="grid sm:grid-cols-3 gap-3 text-sm">
				<div className="card p-4">
					<div className="text-[var(--color-muted)] text-xs">Data sources</div>
					<div className="mt-1">
						{hasDataApis ? (
							<span className="text-[var(--color-success)]">
								SEO/SERP API connected — competitor &amp; keyword enrichment on
							</span>
						) : (
							<>
								Crawl + AI only.{" "}
								<Link href="/settings" className="underline">
									Connect SEMrush/Ahrefs/SERP
								</Link>{" "}
								for competitor analysis, keyword findings &amp; demand forecasting.
							</>
						)}
					</div>
				</div>
				<div className="card p-4">
					<div className="text-[var(--color-muted)] text-xs">Daily digest</div>
					<div className="mt-1">
						{connected.has("resend") ? (
							<span className="text-[var(--color-success)]">
								Resend connected — best-action email scheduled each morning
							</span>
						) : (
							"Connect Resend to get the best topic/action emailed daily."
						)}
					</div>
				</div>
				<div className="card p-4">
					<div className="text-[var(--color-muted)] text-xs">Tracking set</div>
					<div className="mt-1">Target 20–40 prompts spanning the buyer journey (SOP 5.4).</div>
				</div>
			</div>

			<div className="space-y-3">
				{(topics ?? []).length === 0 && (
					<div className="card p-8 text-center text-[var(--color-muted)]">
						No topics yet. Click <span className="font-semibold">Generate topics</span>.
					</div>
				)}
				{(topics ?? []).map(t => (
					<div key={t.id} className="card p-5 flex items-start gap-4">
						<div className="text-center shrink-0">
							<div className="text-2xl font-bold">{t.score ?? "—"}</div>
							<div className="text-[10px] uppercase text-[var(--color-muted)]">value</div>
						</div>
						<div className="flex-1 min-w-0">
							<div className="font-semibold">{t.title}</div>
							<div className="text-sm text-[var(--color-muted)] mt-1">{t.rationale}</div>
							<div className="flex flex-wrap gap-2 mt-2 text-[10px] uppercase tracking-wide">
								{t.cluster && (
									<span className="border rounded px-2 py-0.5 text-[var(--color-accent)]">{t.cluster}</span>
								)}
								{t.win_condition && (
									<span className="border rounded px-2 py-0.5 text-[var(--color-muted)]">
										win: {t.win_condition}
									</span>
								)}
							</div>
						</div>
						<Link
							href={`/writer?title=${encodeURIComponent(t.title)}&topic=${t.id}`}
							className="btn btn-ghost px-3 py-1.5 text-sm shrink-0"
						>
							Write →
						</Link>
					</div>
				))}
			</div>
		</div>
	);
}
