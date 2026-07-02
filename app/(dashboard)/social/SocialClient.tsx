"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { repurposeSocialAction } from "@/lib/actions/ai";

const PLATFORMS = ["LinkedIn", "X (Twitter)", "Instagram", "Facebook", "Threads"];

export function RepurposePanel({ drafts, disabled }: { drafts: { id: string; title: string }[]; disabled: boolean }) {
	const router = useRouter();
	const params = useSearchParams();
	const [contentId, setContentId] = useState(params.get("content") ?? drafts[0]?.id ?? "");
	const [selected, setSelected] = useState<string[]>(["LinkedIn", "X (Twitter)"]);
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	function toggle(p: string) {
		setSelected(s => (s.includes(p) ? s.filter(x => x !== p) : [...s, p]));
	}

	function run() {
		setError(null);
		startTransition(async () => {
			const res = await repurposeSocialAction(contentId, selected);
			if (res.ok) router.refresh();
			else setError(res.error ?? "Failed.");
		});
	}

	return (
		<div className="card p-5 space-y-4">
			<div>
				<label className="text-xs text-[var(--color-muted)]">Source draft</label>
				<select className="input mt-1" value={contentId} onChange={e => setContentId(e.target.value)}>
					{drafts.length === 0 && <option value="">No drafts yet</option>}
					{drafts.map(d => (
						<option key={d.id} value={d.id}>
							{d.title}
						</option>
					))}
				</select>
			</div>
			<div>
				<label className="text-xs text-[var(--color-muted)]">Channels</label>
				<div className="flex flex-wrap gap-2 mt-2">
					{PLATFORMS.map(p => (
						<button
							key={p}
							onClick={() => toggle(p)}
							className={`text-sm rounded-full px-3 py-1.5 border transition-colors ${
								selected.includes(p)
									? "bg-[var(--color-brand)] text-white border-transparent"
									: "border-[var(--color-border)] text-[var(--color-muted)]"
							}`}
						>
							{p}
						</button>
					))}
				</div>
			</div>
			{error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
			<div className="flex justify-end">
				<button
					onClick={run}
					disabled={pending || disabled || !contentId || selected.length === 0}
					className="btn btn-primary px-4 py-2 text-sm"
				>
					{pending ? "Repurposing…" : `Repurpose to ${selected.length} channels`}
				</button>
			</div>
		</div>
	);
}
