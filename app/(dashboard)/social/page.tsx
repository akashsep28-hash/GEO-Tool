import { Suspense } from "react";
import { aiAvailability } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import { RepurposePanel } from "./SocialClient";

export default async function SocialPage() {
	const supabase = await createClient();
	const { data: drafts } = await supabase
		.from("content_pieces")
		.select("id, title")
		.order("created_at", { ascending: false })
		.limit(20);
	const { data: posts } = await supabase
		.from("social_posts")
		.select("id, platform, body, status, created_at")
		.order("created_at", { ascending: false })
		.limit(40);
	const ai = await aiAvailability();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Social Repurposing</h1>
				<p className="text-[var(--color-muted)]">
					Turn each published blog into channel-native posts. Connect the platforms in Settings to publish
					directly.
				</p>
			</div>

			{!ai.available && (
				<div className="card p-4 border-[var(--color-warning)]/40 text-sm text-[var(--color-warning)]">
					Connect an AI model to generate posts.
				</div>
			)}

			<Suspense fallback={<div className="card p-5 h-40" />}>
				<RepurposePanel drafts={drafts ?? []} disabled={!ai.available} />
			</Suspense>

			<div className="space-y-3">
				{(posts ?? []).map(p => (
					<div key={p.id} className="card p-5">
						<div className="flex items-center gap-2">
							<span className="text-xs font-semibold text-[var(--color-accent)]">{p.platform}</span>
							<span className="text-[10px] uppercase text-[var(--color-muted)] border rounded px-2 py-0.5">
								{p.status}
							</span>
						</div>
						<p className="text-sm text-[var(--color-muted)] mt-2 whitespace-pre-wrap">{p.body}</p>
					</div>
				))}
			</div>
		</div>
	);
}
