"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateTopicsAction } from "@/lib/actions/ai";

export function GenerateTopics({ disabled }: { disabled: boolean }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	function run() {
		setError(null);
		startTransition(async () => {
			const res = await generateTopicsAction();
			if (res.ok) router.refresh();
			else setError(res.error ?? "Failed.");
		});
	}

	return (
		<div className="flex flex-col items-end gap-1">
			<button
				onClick={run}
				disabled={pending || disabled}
				className="btn btn-primary px-4 py-2 text-sm"
				title={disabled ? "Connect an AI model first" : undefined}
			>
				{pending ? "Researching…" : "Generate topics"}
			</button>
			{error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
		</div>
	);
}
