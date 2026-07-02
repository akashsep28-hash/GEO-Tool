"use client";

import { useState } from "react";
import { deleteConnectionAction, saveConnectionAction } from "@/lib/actions/connections";
import type { ConnectionProvider } from "@/lib/connections-catalog";

export function ConnectionCard({
	provider,
	connected,
	maskedPreview,
}: {
	provider: ConnectionProvider;
	connected: boolean;
	maskedPreview?: string | null;
}) {
	const [open, setOpen] = useState(false);
	const [values, setValues] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isConnected, setIsConnected] = useState(connected);

	async function save(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const res = await saveConnectionAction(provider.id, values);
		setBusy(false);
		if (res.ok) {
			setIsConnected(true);
			setOpen(false);
			setValues({});
		} else {
			setError(res.error ?? "Something went wrong.");
		}
	}

	async function disconnect() {
		setBusy(true);
		const res = await deleteConnectionAction(provider.id);
		setBusy(false);
		if (res.ok) setIsConnected(false);
	}

	return (
		<div className="card p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<span className="font-semibold">{provider.name}</span>
						{provider.popular && (
							<span className="text-[10px] uppercase tracking-wide text-[var(--color-accent)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
								Popular
							</span>
						)}
						{isConnected && (
							<span className="text-[10px] uppercase tracking-wide text-[var(--color-success)] border border-[var(--color-success)]/40 rounded px-1.5 py-0.5">
								Connected
							</span>
						)}
					</div>
					<p className="text-sm text-[var(--color-muted)] mt-1">{provider.blurb}</p>
					<div className="text-xs text-[var(--color-muted)] mt-2">Unlocks: {provider.unlocks.join(" · ")}</div>
					{isConnected && maskedPreview && (
						<div className="text-xs text-[var(--color-muted)] mt-1 font-mono">{maskedPreview}</div>
					)}
				</div>
				<div className="shrink-0">
					{isConnected ? (
						<button onClick={disconnect} disabled={busy} className="btn btn-ghost px-3 py-1.5 text-sm">
							Disconnect
						</button>
					) : (
						<button onClick={() => setOpen(o => !o)} className="btn btn-primary px-3 py-1.5 text-sm">
							Connect
						</button>
					)}
				</div>
			</div>

			{open && !isConnected && (
				<form onSubmit={save} className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
					{provider.fields.map(f => (
						<div key={f.key}>
							<label className="text-xs text-[var(--color-muted)]">
								{f.label}
								{f.required && <span className="text-[var(--color-danger)]"> *</span>}
							</label>
							{f.type === "textarea" ? (
								<textarea
									className="input mt-1"
									rows={3}
									placeholder={f.placeholder}
									value={values[f.key] ?? ""}
									onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
								/>
							) : (
								<input
									className="input mt-1"
									type={f.type === "password" ? "password" : "text"}
									placeholder={f.placeholder}
									value={values[f.key] ?? ""}
									onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
								/>
							)}
						</div>
					))}
					{error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
					<div className="flex items-center gap-2">
						<button disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
							{busy ? "Saving…" : "Save & encrypt"}
						</button>
						<a
							href={provider.docsUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
						>
							Where do I get this? ↗
						</a>
					</div>
				</form>
			)}
		</div>
	);
}
