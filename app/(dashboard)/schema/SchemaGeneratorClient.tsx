"use client";

import { useState } from "react";
import { schemaScriptTag } from "@/lib/page-gap-export";
import type { SchemaGenResult } from "@/lib/schema-generator";
import { ActivityPanel, type ActivityState, emptyActivity, foldActivity, readNdjson } from "../activity";

export function SchemaGeneratorClient({ defaultUrl = "" }: { defaultUrl?: string }) {
	const [url, setUrl] = useState(defaultUrl);
	const [keyword, setKeyword] = useState("");
	const [country, setCountry] = useState("us");
	const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
	const [activity, setActivity] = useState<ActivityState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<SchemaGenResult | null>(null);
	const pending = activity !== null;

	async function run() {
		setError(null);
		setResult(null);
		setActivity(emptyActivity("Starting — opening Chrome…"));
		try {
			let final: SchemaGenResult | null = null;
			await readNdjson(
				"/api/schema/generate",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ url, keyword, country, device }),
				},
				ev => {
					if (ev.type === "activity") {
						setActivity(a => (a ? foldActivity(a, ev) : a));
					} else if (ev.type === "done") {
						final = (ev.result as SchemaGenResult) ?? null;
					} else if (ev.type === "error") {
						throw new Error(ev.error ?? "Schema generation failed.");
					}
				},
			);
			setActivity(null);
			if (final) setResult(final);
			else setError("The run ended without producing schema.");
		} catch (e) {
			setError((e as Error).message);
			setActivity(null);
		}
	}

	return (
		<div className="space-y-6">
			<div className="card space-y-4 p-6">
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="space-y-1">
						<span className="text-xs text-[var(--color-muted)]">Page URL</span>
						<input
							className="input"
							placeholder="https://example.com/your-page"
							value={url}
							onChange={e => setUrl(e.target.value)}
						/>
					</label>
					<label className="space-y-1">
						<span className="text-xs text-[var(--color-muted)]">Target keyword / topic (optional)</span>
						<input
							className="input"
							placeholder="defaults to the page title"
							value={keyword}
							onChange={e => setKeyword(e.target.value)}
						/>
					</label>
					<label className="space-y-1">
						<span className="text-xs text-[var(--color-muted)]">Country</span>
						<input
							className="input"
							placeholder="us"
							value={country}
							onChange={e => setCountry(e.target.value)}
						/>
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

				<div className="flex flex-wrap items-center gap-3">
					<button onClick={run} disabled={pending} className="btn btn-primary px-5 py-2.5 text-sm">
						{pending ? "Generating…" : "Generate schema"}
					</button>
					<span className="text-xs text-[var(--color-muted)]">
						Renders the page (your installed Chrome, falling back to a direct fetch), preserves any existing
						JSON-LD, and extends it with the types the page is missing — fully grounded in the page content.
					</span>
				</div>

				{activity && (
					<div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
						<ActivityPanel activity={activity} />
					</div>
				)}

				{error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
			</div>

			{result && <SchemaResultView result={result} />}
		</div>
	);
}

function SchemaResultView({ result }: { result: SchemaGenResult }) {
	const { schema, meta } = result;
	const [copied, setCopied] = useState(false);
	const snippet = schemaScriptTag(schema.jsonld);
	const existingTypes = schema.existingTypes ?? [];
	const addedTypes = schema.addedTypes ?? [];
	const recommendations = schema.recommendations ?? [];

	function copy() {
		navigator.clipboard.writeText(snippet).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}

	function downloadJson() {
		const blob = new Blob([JSON.stringify(schema.jsonld, null, 2)], { type: "application/ld+json" });
		const href = URL.createObjectURL(blob);
		const a = document.createElement("a");
		let slug = "schema";
		try {
			const u = new URL(meta.finalUrl || meta.url);
			slug = (u.hostname + u.pathname).replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "");
		} catch {
			/* keep default */
		}
		a.href = href;
		a.download = `${slug || "schema"}.jsonld`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(href);
	}

	return (
		<div className="card space-y-4 p-6">
			{/* Page summary */}
			<div className="space-y-1">
				<div className="truncate font-medium">{meta.title || meta.finalUrl}</div>
				<div className="truncate font-mono text-xs text-[var(--color-accent)]">{meta.finalUrl}</div>
				<div className="flex flex-wrap gap-2 text-[11px] text-[var(--color-muted)]">
					<span className="rounded border border-[var(--color-border)] px-2 py-0.5">
						Page type: {meta.pageType.replace("_", " / ")}
					</span>
					<span className="rounded border border-[var(--color-border)] px-2 py-0.5">{meta.wordCount} words</span>
				</div>
			</div>

			{/* Source + type breakdown */}
			<div className="flex flex-wrap items-center gap-2 text-xs">
				<span
					className={`rounded-full border px-2 py-0.5 ${
						schema.source === "ai"
							? "border-[var(--color-success)]/50 text-[var(--color-success)]"
							: "border-[var(--color-warning)]/50 text-[var(--color-warning)]"
					}`}
				>
					{schema.source === "ai" ? `AI (${schema.model ?? "model"})` : "Deterministic skeleton"}
				</span>
				{existingTypes.map(t => (
					<span
						key={`ex-${t}`}
						className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)]"
						title="Preserved / optimized from the existing page schema"
					>
						{t} <span className="opacity-60">· kept</span>
					</span>
				))}
				{addedTypes.map(t => (
					<span
						key={`add-${t}`}
						className="rounded border border-[var(--color-success)]/40 px-2 py-0.5 text-[var(--color-success)]"
						title="Newly added for this page type"
					>
						{t} <span className="opacity-70">· added</span>
					</span>
				))}
			</div>

			{schema.warnings.length > 0 && (
				<div className="rounded-md border border-[var(--color-warning)]/40 p-3 text-xs text-[var(--color-warning)]">
					{schema.warnings.map(w => (
						<div key={w}>⚠ {w}</div>
					))}
				</div>
			)}

			{recommendations.length > 0 && (
				<div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
					<div className="text-xs font-medium">
						Content needed before this schema can be added{" "}
						<span className="text-[var(--color-muted)]">({recommendations.length})</span>
					</div>
					<p className="text-[11px] text-[var(--color-muted)]">
						These types/fields are warranted but the supporting content isn’t on the page yet. We never invent it
						— add the content, then regenerate to mark it up.
					</p>
					<ul className="space-y-2">
						{recommendations.map(r => (
							<li
								key={`${r.type}-${r.field ?? ""}-${r.action.slice(0, 32)}`}
								className="border-[var(--color-border)] border-t pt-2 text-xs first:border-t-0 first:pt-0"
							>
								<span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] font-medium">
									{r.type}
									{r.field ? <span className="opacity-60"> · {r.field}</span> : null}
								</span>
								<div className="mt-1 text-[var(--color-fg)]">{r.action}</div>
								<div className="mt-0.5 text-[var(--color-muted)]">{r.reason}</div>
							</li>
						))}
					</ul>
				</div>
			)}

			{schema.rationale && <p className="text-sm text-[var(--color-muted)]">{schema.rationale}</p>}

			{/* Actions */}
			<div className="flex flex-wrap gap-2">
				<button onClick={copy} className="btn btn-primary px-3 py-1.5 text-xs">
					{copied ? "Copied!" : "Copy <script> tag"}
				</button>
				<button onClick={downloadJson} className="btn btn-ghost px-3 py-1.5 text-xs">
					⬇ Download .jsonld
				</button>
			</div>

			<pre className="max-h-[32rem] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs leading-relaxed whitespace-pre-wrap break-all text-[var(--color-muted)]">
				{snippet}
			</pre>
		</div>
	);
}
