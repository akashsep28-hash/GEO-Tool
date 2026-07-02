"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { generateBlogAction } from "@/lib/actions/ai";

export function WriterForm({ disabled }: { disabled: boolean }) {
	const router = useRouter();
	const params = useSearchParams();
	const [title, setTitle] = useState(params.get("title") ?? "");
	const topicId = params.get("topic") ?? undefined;
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	function run(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		startTransition(async () => {
			const res = await generateBlogAction(title, topicId);
			if (res.ok) {
				setTitle("");
				router.refresh();
			} else {
				setError(res.error ?? "Failed.");
			}
		});
	}

	return (
		<form onSubmit={run} className="card p-5 space-y-3">
			<input
				className="input"
				placeholder="Working title, e.g. Best CRM for early-stage SaaS in 2026"
				value={title}
				onChange={e => setTitle(e.target.value)}
			/>
			{error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
			<div className="flex items-center justify-between">
				<span className="text-xs text-[var(--color-muted)]">
					Built with the validated GEO tactics: answer-first, statistics, citations, comparison table, FAQ.
				</span>
				<button disabled={pending || disabled || !title.trim()} className="btn btn-primary px-4 py-2 text-sm">
					{pending ? "Writing…" : "Write draft"}
				</button>
			</div>
		</form>
	);
}
