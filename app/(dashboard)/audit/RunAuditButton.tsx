"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runAuditAction } from "@/lib/actions/audit";

export function RunAuditButton({ label = "Run audit" }: { label?: string }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	function run() {
		setError(null);
		startTransition(async () => {
			const res = await runAuditAction();
			if (res.ok) router.refresh();
			else setError(res.error ?? "Audit failed.");
		});
	}

	return (
		<div className="flex flex-col items-end gap-1">
			<button onClick={run} disabled={pending} className="btn btn-primary px-4 py-2 text-sm">
				{pending ? "Crawling site..." : label}
			</button>
			{error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
		</div>
	);
}
