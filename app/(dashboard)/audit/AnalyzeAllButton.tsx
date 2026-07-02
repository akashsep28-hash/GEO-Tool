"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActivityPanel, type ActivityState, emptyActivity, foldActivity, readNdjson } from "../activity";

export type PendingPage = { id: string; url: string };

function shortUrl(url: string): string {
	try {
		const u = new URL(url);
		const path = u.pathname === "/" ? "" : u.pathname;
		const s = `${u.hostname.replace(/^www\./, "")}${path}`;
		return s.length > 48 ? `${s.slice(0, 47)}…` : s;
	} catch {
		return url.slice(0, 48);
	}
}

/**
 * Runs the AI pipeline across all pending pages, one page at a time through the
 * streaming route — so the panel shows exactly which page is being audited and
 * which agent is working on it, with an overall page-count bar.
 */
export function AnalyzeAllButton({
	auditId: _auditId,
	pendingPages,
}: {
	auditId: string;
	pendingPages: PendingPage[];
}) {
	const router = useRouter();
	const [activity, setActivity] = useState<ActivityState | null>(null);
	const [pageNo, setPageNo] = useState(0);
	const [failures, setFailures] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const total = pendingPages.length;

	async function run() {
		setError(null);
		setFailures(0);
		let failed = 0;
		for (let i = 0; i < pendingPages.length; i++) {
			const page = pendingPages[i];
			setPageNo(i + 1);
			setActivity({
				...emptyActivity(`Page ${i + 1}/${total} · ${shortUrl(page.url)}`),
			});
			try {
				await readNdjson(`/api/audit/page/${page.id}/analyze`, { method: "POST" }, ev => {
					if (ev.type === "activity") {
						setActivity(a => (a ? { ...foldActivity(a, ev), headline: a.headline } : a));
					} else if (ev.type === "error") {
						throw new Error(ev.error ?? "Analysis failed.");
					}
				});
			} catch {
				failed++;
				setFailures(failed);
			}
			router.refresh();
		}
		setActivity(null);
		if (failed > 0) setError(`${failed} page(s) failed — open them individually to retry.`);
		router.refresh();
	}

	if (total === 0) {
		return <span className="text-xs text-[var(--color-success)]">All pages analyzed</span>;
	}

	if (activity) {
		return (
			<div className="w-full max-w-md space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
					<div
						className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-300"
						style={{ width: `${Math.max(4, Math.round(((pageNo - 1) / total) * 100))}%` }}
					/>
				</div>
				<ActivityPanel activity={activity} />
				{failures > 0 && (
					<div className="text-[11px] text-[var(--color-warning)]">{failures} page(s) failed so far</div>
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col items-end gap-1">
			<button onClick={run} className="btn btn-primary px-4 py-2 text-sm">
				Analyze all pages ({total})
			</button>
			{error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
		</div>
	);
}
