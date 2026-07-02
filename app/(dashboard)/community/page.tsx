import { createClient } from "@/lib/supabase/server";
import { NewPost } from "./NewPost";

export default async function CommunityPage() {
	const supabase = await createClient();
	const { data: posts } = await supabase
		.from("community_posts")
		.select("id, title, body, author_name, created_at")
		.order("created_at", { ascending: false })
		.limit(50);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Community</h1>
				<p className="text-[var(--color-muted)]">
					Free for every signed-in member. Share GEO wins, ask questions, compare what&apos;s moving citations this
					month.
				</p>
			</div>

			<NewPost />

			<div className="space-y-3">
				{(posts ?? []).length === 0 && (
					<div className="card p-8 text-center text-[var(--color-muted)]">No posts yet — be the first.</div>
				)}
				{(posts ?? []).map(p => (
					<div key={p.id} className="card p-5">
						<div className="font-semibold">{p.title}</div>
						<p className="text-sm text-[var(--color-muted)] mt-1 whitespace-pre-wrap">{p.body}</p>
						<div className="text-xs text-[var(--color-muted)] mt-3">
							{p.author_name} · {new Date(p.created_at).toLocaleDateString()}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
