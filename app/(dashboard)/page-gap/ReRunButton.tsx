"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runPageGapAction } from "@/lib/actions/page-gap";

export function ReRunButton({
	url,
	keyword,
	country,
	device,
}: {
	url: string;
	keyword: string;
	country: string;
	device: "desktop" | "mobile";
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [mode, setMode] = useState<null | "normal" | "interactive">(null);
	const [error, setError] = useState<string | null>(null);

	function rerun(interactive: boolean) {
		setError(null);
		setMode(interactive ? "interactive" : "normal");
		startTransition(async () => {
			const res = await runPageGapAction({ url, keyword, country, device, interactive });
			if (res.ok && res.runId) router.push(`/page-gap/${res.runId}`);
			else setError(res.error ?? "Re-run failed.");
			setMode(null);
		});
	}

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="flex flex-wrap gap-2">
				<button onClick={() => rerun(false)} disabled={pending} className="btn btn-ghost px-3 py-1.5 text-xs">
					{pending && mode === "normal" ? "Re-running SERP…" : "Re-run SERP"}
				</button>
				<button onClick={() => rerun(true)} disabled={pending} className="btn btn-primary px-3 py-1.5 text-xs">
					{pending && mode === "interactive" ? "Chrome open — solve the check…" : "Re-run (solve CAPTCHA)"}
				</button>
			</div>
			{error && <span className="max-w-xs text-right text-xs text-[var(--color-danger)]">{error}</span>}
		</div>
	);
}
