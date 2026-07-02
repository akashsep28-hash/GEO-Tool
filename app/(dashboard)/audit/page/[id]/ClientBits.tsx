"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* clipboard blocked */
		}
	}
	return (
		<button onClick={copy} className="btn btn-ghost px-3 py-1.5 text-xs">
			{copied ? "Copied ✓" : label}
		</button>
	);
}

export function PreviewFrame({ html }: { html: string }) {
	const [show, setShow] = useState(false);
	return (
		<div className="mt-3">
			<button onClick={() => setShow(s => !s)} className="btn btn-ghost px-3 py-1.5 text-xs">
				{show ? "Hide rendered preview" : "Preview rendered (sandboxed)"}
			</button>
			{show && (
				<iframe
					// sandbox="" disables scripts/forms — safe preview of generated markup.
					sandbox=""
					srcDoc={html}
					className="mt-3 h-[520px] w-full rounded-lg border border-[var(--color-border)] bg-white"
					title="Corrected page preview"
				/>
			)}
		</div>
	);
}

export function Collapsible({
	title,
	subtitle,
	children,
	defaultOpen = false,
}: {
	title: string;
	subtitle?: string;
	children: React.ReactNode;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="card overflow-hidden">
			<button
				onClick={() => setOpen(o => !o)}
				className="w-full flex items-center justify-between px-5 py-3 text-left"
			>
				<span>
					<span className="font-semibold">{title}</span>
					{subtitle && <span className="ml-2 text-xs text-[var(--color-muted)]">{subtitle}</span>}
				</span>
				<span className="text-[var(--color-muted)]">{open ? "▲" : "▼"}</span>
			</button>
			{open && <div className="border-t border-[var(--color-border)]">{children}</div>}
		</div>
	);
}
