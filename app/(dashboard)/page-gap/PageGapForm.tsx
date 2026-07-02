"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useElapsed } from "../activity";

type Progress = { pct: number; label: string; stage?: string; current?: number; total?: number };

const STAGE_LABEL: Record<string, string> = {
	starting: "Launching Chrome",
	serp: "Reading the SERP",
	competitor: "Auditing ranking pages",
	target: "Auditing your page",
	scoring: "Scoring & site checks",
	done: "Saving",
};

export function PageGapForm({ defaultUrl = "" }: { defaultUrl?: string }) {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [progress, setProgress] = useState<Progress | null>(null);
	const [url, setUrl] = useState(defaultUrl);
	const [keyword, setKeyword] = useState("");
	const [country, setCountry] = useState("us");
	const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
	const [interactive, setInteractive] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const elapsed = useElapsed(startedAt);

	async function run() {
		setError(null);
		setPending(true);
		setStartedAt(Date.now());
		setProgress({ pct: 2, label: "Starting…", stage: "starting" });
		try {
			const res = await fetch("/api/page-gap/run", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url, keyword, country, device, interactive }),
			});
			if (!res.ok || !res.body) {
				throw new Error(`Request failed (${res.status}).`);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let runId: string | undefined;

			// Read the NDJSON progress stream line-by-line in real time.
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					let ev: {
						type: string;
						pct?: number;
						label?: string;
						stage?: string;
						current?: number;
						total?: number;
						runId?: string;
						error?: string;
					};
					try {
						ev = JSON.parse(line);
					} catch {
						continue;
					}
					if (ev.type === "progress") {
						setProgress({
							pct: ev.pct ?? 0,
							label: ev.label ?? "Working…",
							stage: ev.stage,
							current: ev.current,
							total: ev.total,
						});
					} else if (ev.type === "done") {
						runId = ev.runId;
						setProgress({ pct: 100, label: "Done — opening report…" });
					} else if (ev.type === "error") {
						setError(ev.error ?? "Analysis failed.");
						setProgress(null);
						setPending(false);
						return;
					}
				}
			}

			if (runId) {
				router.push(`/page-gap/${runId}`);
			} else {
				setError("The run ended without producing a report.");
				setProgress(null);
				setPending(false);
			}
		} catch (e) {
			setError((e as Error).message);
			setProgress(null);
			setPending(false);
		}
	}

	return (
		<div className="card p-6 space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="space-y-1">
					<span className="text-xs text-[var(--color-muted)]">Target page URL</span>
					<input
						className="input"
						placeholder="https://example.com/your-page"
						value={url}
						onChange={e => setUrl(e.target.value)}
					/>
				</label>
				<label className="space-y-1">
					<span className="text-xs text-[var(--color-muted)]">Target keyword</span>
					<input
						className="input"
						placeholder="e.g. personal loan eligibility"
						value={keyword}
						onChange={e => setKeyword(e.target.value)}
					/>
				</label>
				<label className="space-y-1">
					<span className="text-xs text-[var(--color-muted)]">Country</span>
					<input className="input" placeholder="us" value={country} onChange={e => setCountry(e.target.value)} />
				</label>
				<label className="space-y-1">
					<span className="text-xs text-[var(--color-muted)]">Device</span>
					<select
						className="input"
						value={device}
						onChange={e => setDevice(e.target.value as "desktop" | "mobile")}
					>
						<option value="desktop">Desktop</option>
						<option value="mobile">Mobile</option>
					</select>
				</label>
			</div>

			<label className="flex items-start gap-2 text-xs text-[var(--color-muted)]">
				<input
					type="checkbox"
					checked={interactive}
					onChange={e => setInteractive(e.target.checked)}
					className="mt-0.5"
				/>
				<span>
					<span className="text-[var(--color-fg)]">Solve Google check manually.</span> Opens a{" "}
					<strong>visible</strong> Chrome window — if Google shows a “unusual traffic”/CAPTCHA page, clear it
					yourself and the tool harvests the results once it loads. Use this if a normal run fails.
				</span>
			</label>

			<div className="flex flex-wrap items-center gap-3">
				<button onClick={run} disabled={pending} className="btn btn-primary px-5 py-2.5 text-sm">
					{pending
						? interactive
							? "Chrome open — solve the check…"
							: "Opening Chrome & analyzing…"
						: "Run gap analysis"}
				</button>
				<span className="text-xs text-[var(--color-muted)]">
					Opens your installed Chrome, reads the live top-10 SERP, and audits all 11 pages. Keep this tab open — a
					run takes ~30–90s
					{interactive ? " (longer if you’re solving a check)" : ""}.
				</span>
			</div>
			{progress && (
				<div className="space-y-1.5" role="status" aria-live="polite">
					<div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
						<div
							className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-500 ease-out"
							style={{ width: `${Math.min(100, Math.max(2, progress.pct))}%` }}
						/>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
						{progress.stage && (
							<span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-brand)]">
								{STAGE_LABEL[progress.stage] ?? progress.stage}
							</span>
						)}
						<span className="text-[var(--color-fg)]">{progress.label}</span>
						{progress.current !== undefined && progress.total !== undefined && (
							<span className="tabular-nums">
								page {progress.current}/{progress.total}
							</span>
						)}
						<span className="ml-auto flex gap-3 tabular-nums">
							<span>{elapsed}</span>
							<span>{Math.round(progress.pct)}%</span>
						</span>
					</div>
				</div>
			)}

			{error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
		</div>
	);
}
