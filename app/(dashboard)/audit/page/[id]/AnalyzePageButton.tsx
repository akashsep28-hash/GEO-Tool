"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActivityPanel, type ActivityState, emptyActivity, foldActivity, readNdjson } from "../../../activity";

export function AnalyzePageButton({ pageId, hasResult }: { pageId: string; hasResult: boolean }) {
	const router = useRouter();
	const [activity, setActivity] = useState<ActivityState | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function run() {
		setError(null);
		setActivity(emptyActivity("Starting the audit pipeline…"));
		try {
			let done = false;
			await readNdjson(`/api/audit/page/${pageId}/analyze`, { method: "POST" }, ev => {
				if (ev.type === "progress" || ev.type === "activity") {
					setActivity(a => (a ? foldActivity(a, ev) : a));
				} else if (ev.type === "partial") {
					// A stage's analysis is persisted — surface it on the page now.
					router.refresh();
				} else if (ev.type === "done") {
					done = true;
				} else if (ev.type === "error") {
					throw new Error(ev.error ?? "Analysis failed.");
				}
			});
			setActivity(null);
			if (done) router.refresh();
		} catch (e) {
			setError((e as Error).message);
			setActivity(null);
		}
	}

	if (activity) {
		return (
			<div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
				<ActivityPanel activity={activity} />
			</div>
		);
	}

	return (
		<div className="flex flex-col items-end gap-1">
			<button onClick={run} className="btn btn-primary px-4 py-2 text-sm">
				{hasResult ? "Re-run AI analysis" : "Run AI analysis"}
			</button>
			{error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
		</div>
	);
}
