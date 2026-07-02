import Link from "next/link";
import { getActor } from "@/lib/actor";
import { getGuestProject } from "@/lib/guest-session";
import { listPageGapRuns } from "@/lib/page-gap-store";
import { createClient } from "@/lib/supabase/server";
import { PageGapForm } from "./PageGapForm";

const VERDICT_LABEL: Record<string, string> = {
	service_page: "Service page",
	informational: "Informational",
	hybrid_required: "Hybrid required",
};

export default async function PageGapIndex() {
	const actor = await getActor();

	let defaultUrl = "";
	if (actor.kind === "guest") {
		const gp = await getGuestProject();
		defaultUrl = gp?.website_url ?? "";
	} else {
		const supabase = await createClient();
		const { data: p } = await supabase.from("projects").select("website_url").eq("is_primary", true).maybeSingle();
		defaultUrl = p?.website_url ?? "";
	}

	const runs = await listPageGapRuns();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Page Gap Analyzer</h1>
				<p className="text-[var(--color-muted)]">
					Enter a URL + keyword. The tool reads the live top-10 SERP, checks whether your page is even the right
					format (7-rule intent gate), then sources every gap to the ranking pages that prove it.
				</p>
			</div>

			<PageGapForm defaultUrl={defaultUrl} />

			<div className="card p-6 space-y-4">
				<h2 className="font-semibold">Recent runs</h2>
				{runs.length === 0 ? (
					<p className="text-sm text-[var(--color-muted)]">No runs yet. Run your first gap analysis above.</p>
				) : (
					<div className="space-y-2">
						{runs.map(r => (
							<Link
								key={r.id}
								href={`/page-gap/${r.id}`}
								className="block rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 transition-colors hover:border-[var(--color-brand)]"
							>
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<div className="truncate font-medium">{r.keyword}</div>
										<div className="truncate font-mono text-xs text-[var(--color-accent)]">{r.targetUrl}</div>
									</div>
									<div className="flex shrink-0 items-center gap-2 text-[10px] uppercase tracking-wide">
										{r.mismatch && (
											<span className="rounded border border-[var(--color-danger)]/40 px-2 py-0.5 text-[var(--color-danger)]">
												intent mismatch
											</span>
										)}
										{r.verdict && (
											<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)]">
												{VERDICT_LABEL[r.verdict] ?? r.verdict}
											</span>
										)}
										<span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)]">
											{r.score ?? 0}/100
										</span>
									</div>
								</div>
							</Link>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
