"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The hero CTA: enter a URL → straight into onboarding (guest, no login wall). */
export function HeroForm() {
	const [url, setUrl] = useState("");
	const router = useRouter();

	function go(e: React.FormEvent) {
		e.preventDefault();
		const clean = url.trim();
		if (!clean) return;
		router.push(`/onboarding?url=${encodeURIComponent(clean)}`);
	}

	return (
		<form onSubmit={go} className="mt-8 flex flex-col sm:flex-row gap-3 max-w-xl">
			<input
				className="input flex-1 text-base"
				placeholder="yourwebsite.com"
				value={url}
				onChange={e => setUrl(e.target.value)}
				autoComplete="url"
				inputMode="url"
				aria-label="Your website URL"
			/>
			<button className="btn btn-primary px-6 py-3 text-base whitespace-nowrap">Audit my site →</button>
		</form>
	);
}
