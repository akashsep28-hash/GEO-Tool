import Link from "next/link";
import { Suspense } from "react";
import { aiAvailability } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import { WriterForm } from "./WriterClient";

export default async function WriterPage() {
	const supabase = await createClient();
	const { data: drafts } = await supabase
		.from("content_pieces")
		.select("id, title, body, status, created_at")
		.order("created_at", { ascending: false })
		.limit(20);
	const ai = await aiAvailability();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Blog Writer</h1>
				<p className="text-[var(--color-muted)]">
					Long-form drafts engineered for AI citation. Drafts can be repurposed for social and published to your
					CMS.
				</p>
			</div>

			{!ai.available && (
				<div className="card p-4 border-[var(--color-warning)]/40 text-sm text-[var(--color-warning)]">
					Connect an AI model in Settings (or set ANTHROPIC_API_KEY) to write.
				</div>
			)}

			<Suspense fallback={<div className="card p-5 h-28" />}>
				<WriterForm disabled={!ai.available} />
			</Suspense>

			<div className="space-y-3">
				{(drafts ?? []).length === 0 && (
					<div className="card p-8 text-center text-[var(--color-muted)]">No drafts yet.</div>
				)}
				{(drafts ?? []).map(d => (
					<div key={d.id} className="card p-5">
						<div className="flex items-center justify-between gap-3">
							<div className="font-semibold">{d.title}</div>
							<div className="flex items-center gap-3 shrink-0">
								<span className="text-[10px] uppercase text-[var(--color-muted)] border rounded px-2 py-0.5">
									{d.status}
								</span>
								<Link
									href={`/social?content=${d.id}`}
									className="text-sm underline text-[var(--color-muted)] hover:text-[var(--color-fg)]"
								>
									Repurpose →
								</Link>
							</div>
						</div>
						<p className="text-sm text-[var(--color-muted)] mt-2 line-clamp-3 whitespace-pre-wrap">
							{(d.body ?? "").slice(0, 320)}…
						</p>
					</div>
				))}
			</div>
		</div>
	);
}
