"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCommunityPost } from "@/lib/actions/community";

export function NewPost() {
	const router = useRouter();
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		startTransition(async () => {
			const res = await createCommunityPost(title, body);
			if (res.ok) {
				setTitle("");
				setBody("");
				router.refresh();
			} else {
				setError(res.error ?? "Could not post.");
			}
		});
	}

	return (
		<form onSubmit={submit} className="card p-5 space-y-3">
			<input
				className="input"
				placeholder="Start a discussion…"
				value={title}
				onChange={e => setTitle(e.target.value)}
			/>
			<textarea
				className="input"
				rows={3}
				placeholder="Share a GEO win, question, or finding."
				value={body}
				onChange={e => setBody(e.target.value)}
			/>
			{error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
			<div className="flex justify-end">
				<button disabled={pending} className="btn btn-primary px-4 py-2 text-sm">
					{pending ? "Posting…" : "Post"}
				</button>
			</div>
		</form>
	);
}
