"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActivityPanel, type ActivityState, emptyActivity, foldActivity, readNdjson } from "../activity";

export function GenerateSchemaButton({ runId, status }: { runId: string; status: string }) {
	const router = useRouter();
	const [activity, setActivity] = useState<ActivityState | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function run() {
		setError(null);
		setActivity(emptyActivity("Preparing schema generation…"));
		try {
			let done = false;
			await readNdjson(`/api/page-gap/${runId}/schema`, { method: "POST" }, ev => {
				if (ev.type === "progress" || ev.type === "activity") {
					setActivity(a => (a ? foldActivity(a, ev) : a));
				} else if (ev.type === "done") {
					done = true;
				} else if (ev.type === "error") {
					throw new Error(ev.error ?? "Schema generation failed.");
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

	const done = status === "done";
	return (
		<div className="flex flex-col items-start gap-1">
			<button
				onClick={run}
				className={`btn px-4 py-2 text-sm ${done ? "btn-ghost" : "btn-primary"}`}
				title="Generate Schema.org JSON-LD for the target page, sourced from the benchmark + page signals"
			>
				{done ? "Regenerate schema" : "Generate schema"}
			</button>
			{error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
		</div>
	);
}
