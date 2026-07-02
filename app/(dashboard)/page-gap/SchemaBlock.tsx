"use client";

import { useState, useTransition } from "react";
import { draftPageGapContentAction } from "@/lib/actions/page-gap";
import { schemaScriptTag } from "@/lib/page-gap-export";
import type { DraftContentResult, SchemaResult } from "@/lib/page-gap-schema";

export function SchemaBlock({ schema, targetUrl, runId }: { schema: SchemaResult; targetUrl: string; runId: string }) {
	const [copied, setCopied] = useState(false);
	const snippet = schemaScriptTag(schema.jsonld);
	const existingTypes = schema.existingTypes ?? [];
	const addedTypes = schema.addedTypes ?? [];
	const gapSignals = schema.gapSignals ?? [];
	const faqFromPrompts = schema.faqFromPrompts ?? [];
	const recommendations = schema.recommendations ?? [];
	const draftableQuestions = [...new Set(recommendations.map(r => r.question).filter((q): q is string => !!q))];

	const [drafting, startDrafting] = useTransition();
	const [draft, setDraft] = useState<DraftContentResult | null>(null);
	const [draftError, setDraftError] = useState<string | null>(null);

	function generateDrafts() {
		setDraftError(null);
		startDrafting(async () => {
			const res = await draftPageGapContentAction(runId, draftableQuestions);
			if (res.ok && res.result) setDraft(res.result);
			else setDraftError(res.error ?? "Draft generation failed.");
		});
	}

	function copy() {
		navigator.clipboard.writeText(snippet).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}

	function downloadJson() {
		const blob = new Blob([JSON.stringify(schema.jsonld, null, 2)], {
			type: "application/ld+json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		let slug = "schema";
		try {
			const u = new URL(targetUrl);
			slug = (u.hostname + u.pathname).replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "");
		} catch {
			/* keep default */
		}
		a.href = url;
		a.download = `${slug || "schema"}.jsonld`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	return (
		<div className="space-y-4">
			{/* Source + type breakdown */}
			<div className="space-y-2">
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
							title="Newly added based on gap findings + benchmark"
						>
							{t} <span className="opacity-70">· added</span>
						</span>
					))}
				</div>
				{gapSignals.length > 0 && (
					<div className="text-xs text-[var(--color-muted)]">
						<span className="font-medium">Additions driven by gaps:</span> {gapSignals.join("; ")}
					</div>
				)}
				{faqFromPrompts.length > 0 && (
					<div className="text-xs text-[var(--color-muted)]">
						<span className="font-medium text-[var(--color-success)]">
							{faqFromPrompts.length} GEO prompt(s) folded into the FAQ schema:
						</span>{" "}
						{faqFromPrompts.map(q => `“${q}”`).join(", ")}
					</div>
				)}
			</div>

			{schema.warnings.length > 0 && (
				<div className="rounded-md border border-[var(--color-warning)]/40 p-3 text-xs text-[var(--color-warning)]">
					{schema.warnings.map((w, i) => (
						<div key={i}>⚠ {w}</div>
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
						These types/fields are warranted by the benchmark but the supporting content isn’t on the page yet. We
						never invent it — add the content, then regenerate to mark it up.
					</p>
					<ul className="space-y-2">
						{recommendations.map(r => (
							<li
								key={`${r.type}-${r.field ?? ""}-${r.action.slice(0, 32)}`}
								className="border-[var(--color-border)] border-t pt-2 text-xs first:border-t-0 first:pt-0"
							>
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] font-medium">
										{r.type}
										{r.field ? <span className="opacity-60"> · {r.field}</span> : null}
									</span>
								</div>
								<div className="mt-1 text-[var(--color-fg)]">{r.action}</div>
								<div className="mt-0.5 text-[var(--color-muted)]">{r.reason}</div>
							</li>
						))}
					</ul>
					{draftableQuestions.length > 0 && (
						<div className="flex flex-wrap items-center gap-2 pt-1">
							<button
								onClick={generateDrafts}
								disabled={drafting}
								className="btn btn-primary px-3 py-1.5 text-xs"
							>
								{drafting
									? "Drafting from page content…"
									: `Draft content for ${draftableQuestions.length} question(s)`}
							</button>
							<span className="text-[11px] text-[var(--color-muted)]">
								Uses your page’s own text — never invents facts.
							</span>
							{draftError && <span className="text-xs text-[var(--color-danger)]">{draftError}</span>}
						</div>
					)}
				</div>
			)}

			{draft && (
				<div className="space-y-3 rounded-md border border-[var(--color-success)]/40 bg-[var(--color-surface)] p-3">
					<div className="text-xs font-medium text-[var(--color-success)]">Content to publish on your page</div>
					<div className="rounded border border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10 p-2 text-[11px] text-[var(--color-warning)]">
						⚠ Add this copy to the live page first, then deploy the FAQ schema below. The schema must describe
						content that is actually on the page.
					</div>
					{draft.warnings.map(w => (
						<div key={w} className="text-[11px] text-[var(--color-warning)]">
							⚠ {w}
						</div>
					))}

					{draft.drafts.length > 0 ? (
						<>
							<ol className="space-y-2">
								{draft.drafts.map(d => (
									<li
										key={d.question}
										className="border-[var(--color-border)] border-t pt-2 first:border-t-0 first:pt-0"
									>
										<div className="text-xs font-medium text-[var(--color-fg)]">{d.question}</div>
										<div className="mt-0.5 text-xs text-[var(--color-muted)]">{d.answer}</div>
									</li>
								))}
							</ol>
							<div>
								<div className="mb-1 text-[11px] font-medium text-[var(--color-muted)]">
									Matching FAQ schema (deploy after the copy is live)
								</div>
								<pre className="max-h-72 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[11px] whitespace-pre-wrap break-all text-[var(--color-muted)]">
									{schemaScriptTag(draft.faqJsonld)}
								</pre>
							</div>
						</>
					) : (
						<div className="text-xs text-[var(--color-muted)]">
							None of these questions can be answered from the page’s current content.
						</div>
					)}

					{draft.unanswerable.length > 0 && (
						<div className="space-y-1">
							<div className="text-[11px] font-medium text-[var(--color-muted)]">
								Needs facts from you (not on the page — we won’t invent them):
							</div>
							<ul className="list-inside list-disc text-[11px] text-[var(--color-muted)]">
								{draft.unanswerable.map(q => (
									<li key={q}>{q}</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}

			{schema.rationale && <p className="text-sm text-[var(--color-muted)]">{schema.rationale}</p>}

			{/* Competitor schema prevalence — why these types */}
			{schema.competitorSchemaTypes.length > 0 && (
				<div className="space-y-1">
					<div className="text-xs font-medium">Schema across the ranking pages (from the benchmark)</div>
					<div className="flex flex-wrap gap-1.5">
						{schema.competitorSchemaTypes.map(c => (
							<span
								key={c.type}
								className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
							>
								{c.type}{" "}
								<span className="opacity-70">
									{c.count}/{c.total}
								</span>
							</span>
						))}
					</div>
				</div>
			)}

			{/* Actions */}
			<div className="flex flex-wrap gap-2">
				<button onClick={copy} className="btn btn-primary px-3 py-1.5 text-xs">
					{copied ? "Copied!" : "Copy <script> tag"}
				</button>
				<button onClick={downloadJson} className="btn btn-ghost px-3 py-1.5 text-xs">
					⬇ Download .jsonld
				</button>
			</div>

			{/* The snippet */}
			<pre className="max-h-[32rem] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs leading-relaxed text-[var(--color-muted)] whitespace-pre-wrap break-all">
				{snippet}
			</pre>
		</div>
	);
}
