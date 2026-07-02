import Link from "next/link";
import { connectedProviderIds } from "@/lib/connections";

const KPIS = [
	["Mention rate", "% of tracked-prompt answers that name the brand"],
	["Citation rate", "% of answers with a clickable link to your domain"],
	["Share of voice", "Brand mention frequency vs competitors"],
	["Position", "Where in the answer the brand appears"],
	["Sentiment", "Positive / neutral / negative framing"],
	["Narrative accuracy", "Is the description correct & on-positioning"],
	["Drift", "How visibility moves week over week"],
	["Citation domain pull", "Which third-party domains engines cite (outreach list)"],
];

export default async function PerformancePage() {
	const connected = await connectedProviderIds();
	const analytics = ["ga4", "gsc", "ahrefs", "semrush", "screamingfrog"].filter(p => connected.has(p));

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Performance Tracker</h1>
				<p className="text-[var(--color-muted)]">
					GEO KPIs (citations &amp; mentions, not rankings) plus your analytics, with gaps surfaced automatically
					(SOP Part 9).
				</p>
			</div>

			<div className="card p-4 text-sm">
				{analytics.length ? (
					<span className="text-[var(--color-success)]">
						Connected: {analytics.join(", ")}. Metrics will populate from these sources on the next sync.
					</span>
				) : (
					<>
						No analytics connected yet. The KPI framework below is ready —{" "}
						<Link href="/settings" className="underline">
							connect GA4, GSC, Ahrefs, SEMrush, or Screaming Frog
						</Link>{" "}
						to populate it.
					</>
				)}
			</div>

			<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
				{KPIS.map(([t, d]) => (
					<div key={t} className="card p-5">
						<div className="text-2xl font-bold text-[var(--color-muted)]">—</div>
						<div className="font-semibold mt-2">{t}</div>
						<div className="text-xs text-[var(--color-muted)] mt-1">{d}</div>
					</div>
				))}
			</div>

			<div className="card p-6 text-sm text-[var(--color-muted)]">
				Reporting cadence (SOP 9.2): daily anomaly alerts · weekly digest · monthly white-label report · quarterly
				QBR tied to branded-search lift and verified sales. Connect your data sources to switch these on.
			</div>
		</div>
	);
}
