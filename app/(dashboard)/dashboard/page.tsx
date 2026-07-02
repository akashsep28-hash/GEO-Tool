import Link from "next/link";
import { getActor } from "@/lib/actor";
import { connectedProviderIds } from "@/lib/connections";
import { getGuestAudit, getGuestProject } from "@/lib/guest-session";
import { createClient } from "@/lib/supabase/server";

function ScoreRing({ score }: { score: number }) {
	const color = score >= 80 ? "var(--color-success)" : score >= 55 ? "var(--color-warning)" : "var(--color-danger)";
	return (
		<div
			className="relative h-28 w-28 rounded-full grid place-items-center"
			style={{
				background: `conic-gradient(${color} ${score * 3.6}deg, var(--color-surface-2) 0deg)`,
			}}
		>
			<div className="h-20 w-20 rounded-full bg-[var(--color-surface)] grid place-items-center">
				<span className="text-2xl font-bold">{score}</span>
			</div>
		</div>
	);
}

export default async function DashboardPage() {
	const actor = await getActor();

	let project: { name: string; website_url: string } | null = null;
	let latestAudit: { score: number | null; created_at: string } | null = null;
	let todayAction: { title: string; detail: string | null } | null = null;
	let connected = new Set<string>();

	if (actor.kind === "guest") {
		const gp = await getGuestProject();
		project = gp ? { name: gp.name, website_url: gp.website_url } : null;
		const ga = await getGuestAudit();
		latestAudit = ga ? { score: ga.score, created_at: ga.created_at } : null;
	} else {
		const supabase = await createClient();
		const { data: p } = await supabase
			.from("projects")
			.select("id, name, website_url, industry")
			.eq("is_primary", true)
			.maybeSingle();
		project = p ? { name: p.name, website_url: p.website_url } : null;

		const { data: a } = await supabase
			.from("audits")
			.select("id, score, created_at")
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		latestAudit = a ?? null;

		const { data: action } = await supabase
			.from("daily_actions")
			.select("title, detail")
			.eq("for_date", new Date().toISOString().slice(0, 10))
			.limit(1)
			.maybeSingle();
		todayAction = action ?? null;

		connected = await connectedProviderIds();
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Dashboard</h1>
				<p className="text-[var(--color-muted)]">
					{project ? (
						<>
							{project.name} ·{" "}
							<span className="font-mono text-[var(--color-accent)]">{project.website_url}</span>
						</>
					) : (
						"No project yet — finish onboarding to add your site."
					)}
				</p>
			</div>

			<div className="grid lg:grid-cols-3 gap-4">
				{/* Audit score */}
				<div className="card p-6 flex items-center gap-5">
					{latestAudit ? (
						<>
							<ScoreRing score={latestAudit.score ?? 0} />
							<div>
								<div className="text-sm text-[var(--color-muted)]">GEO Score</div>
								<div className="text-xs text-[var(--color-muted)] mt-1">
									Last audit {new Date(latestAudit.created_at).toLocaleDateString()}
								</div>
								<Link href="/audit" className="btn btn-ghost px-3 py-1.5 text-sm mt-3 inline-flex">
									View findings →
								</Link>
							</div>
						</>
					) : (
						<div>
							<div className="text-sm text-[var(--color-muted)]">No audit yet</div>
							<Link href="/audit" className="btn btn-primary px-3 py-1.5 text-sm mt-3 inline-flex">
								Run first audit →
							</Link>
						</div>
					)}
				</div>

				{/* Today's action */}
				<div className="card p-6 lg:col-span-2">
					<div className="text-xs uppercase tracking-wide text-[var(--color-accent)]">Best action today</div>
					{todayAction ? (
						<>
							<div className="font-semibold mt-2">{todayAction.title}</div>
							<p className="text-sm text-[var(--color-muted)] mt-1">{todayAction.detail}</p>
						</>
					) : (
						<p className="text-sm text-[var(--color-muted)] mt-2">
							Your daily best-topic / best-action recommendation appears here each morning once topic research
							has run. Connect an SEO or SERP API to enrich it, and Resend to get it emailed.
						</p>
					)}
				</div>
			</div>

			{/* Quick links */}
			<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{[
					["/audit", "Website Audit", "Exact problems + exact fixes"],
					["/topics", "Topics & Prompts", "Demand map + daily best topic"],
					["/writer", "Blog Writer", "GEO-optimised long-form"],
					["/social", "Social Repurposing", "Blog → channel-native posts"],
					["/performance", "Performance", "Citations, mentions, gaps"],
					["/community", "Community", "Free for every member"],
				].map(([href, title, sub]) => (
					<Link key={href} href={href} className="card p-5 hover:border-[var(--color-brand)] transition-colors">
						<div className="font-semibold">{title}</div>
						<div className="text-sm text-[var(--color-muted)] mt-1">{sub}</div>
					</Link>
				))}
			</div>

			<div className="text-xs text-[var(--color-muted)]">
				{connected.size} API{connected.size === 1 ? "" : "s"} connected ·{" "}
				<Link href="/settings" className="underline">
					Manage connections
				</Link>
			</div>
		</div>
	);
}
