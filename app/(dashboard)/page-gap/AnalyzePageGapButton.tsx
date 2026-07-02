"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActivityPanel, type ActivityState, emptyActivity, foldActivity, readNdjson } from "../activity";

export function AnalyzePageGapButton({ runId, status }: { runId: string; status: string }) {
	const router = useRouter();
	const [running, setRunning] = useState(false);
	const [activity, setActivity] = useState<ActivityState | null>(null);
	const [progress, setProgress] = useState<{ step: number; total: number }>({ step: 0, total: 5 });
	const [error, setError] = useState<string | null>(null);

	async function run() {
		setError(null);
		setRunning(true);
		setProgress({ step: 0, total: 5 });
		setActivity(emptyActivity("Starting the 5 analysis sections…"));
		try {
			let done = false;
			await readNdjson(`/api/page-gap/${runId}/analyze`, { method: "POST" }, ev => {
				if (ev.type === "progress") {
					setProgress({ step: ev.step ?? 0, total: ev.total ?? 5 });
				}
				if (ev.type === "partial") {
					// This section's analysis is persisted — surface it in the report now.
					router.refresh();
				}
				if (ev.type === "progress" || ev.type === "activity") {
					setActivity(a => (a ? foldActivity(a, ev) : a));
				} else if (ev.type === "done") {
					done = true;
				} else if (ev.type === "error") {
					throw new Error(ev.error ?? "AI analysis failed.");
				}
			});
			setActivity(null);
			setRunning(false);
			if (done) router.refresh();
		} catch (e) {
			setError((e as Error).message);
			setActivity(null);
			setRunning(false);
		}
	}

	if (running && activity) {
		return (
			<div className="w-full max-w-md space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
				{/* Segmented section bar — 5 sections, filled as each completes. */}
				<div className="flex gap-1">
					{Array.from({ length: progress.total }, (_, i) => (
						<div
							key={i}
							className={`h-1.5 flex-1 rounded-full ${
								i + 1 < progress.step
									? "bg-[var(--color-accent)]"
									: i + 1 === progress.step
										? "animate-pulse bg-[var(--color-brand)]"
										: "bg-[var(--color-border)]"
							}`}
						/>
					))}
				</div>
				<ActivityPanel activity={activity} />
			</div>
		);
	}

	const done = status === "done";
	return (
		<div className="flex flex-col items-end gap-1">
			<button onClick={run} className={`btn px-4 py-2 text-sm ${done ? "btn-ghost" : "btn-primary"}`}>
				{done ? "Regenerate AI analysis" : "Generate AI analysis"}
			</button>
			{error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
		</div>
	);
}
