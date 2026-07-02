"use client";

import { useState } from "react";
import type { UniqueItem } from "@/lib/page-gap-artifacts";
import type { HeadingBlueprintItem } from "@/lib/page-gap-llm";

export type SchemaTypeNames = {
	existing: string[];
	recommended: string[];
	added: string[];
	primary: string;
};

type ArtifactLink = { url: string; text: string; kind: string };

type Tab = "structure" | "schema" | "links" | "unique";

const TABS: { key: Tab; label: string }[] = [
	{ key: "structure", label: "a · Heading structure" },
	{ key: "schema", label: "b · Schema set" },
	{ key: "links", label: "c · Links" },
	{ key: "unique", label: "d · Unique items" },
];

const STATUS_STYLE: Record<HeadingBlueprintItem["status"], { label: string; color: string }> = {
	keep: { label: "keep", color: "var(--color-success)" },
	improve: { label: "improve", color: "var(--color-warning)" },
	add: { label: "add", color: "var(--color-accent)" },
};

export function Artifacts({
	headingBlueprint,
	schemaTypeNames,
	links,
	uniqueItems,
	aiReady,
}: {
	headingBlueprint: HeadingBlueprintItem[];
	schemaTypeNames: SchemaTypeNames;
	links: ArtifactLink[];
	uniqueItems: UniqueItem[];
	aiReady: boolean;
}) {
	const [tab, setTab] = useState<Tab>("structure");

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-2">
				{TABS.map(x => (
					<button
						key={x.key}
						onClick={() => setTab(x.key)}
						className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
							tab === x.key
								? "border-[var(--color-brand)] bg-[var(--color-surface-2)] text-[var(--color-fg)]"
								: "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
						}`}
					>
						{x.label}
					</button>
				))}
			</div>

			{/* a — Perfect heading structure (hierarchical headings + what to add). */}
			{tab === "structure" && (
				<div className="space-y-2">
					<p className="text-xs text-[var(--color-muted)]">
						The hierarchical heading structure this page should adopt to match the SERP intent — sourced from the
						gap analysis. Only headings and new-section additions, not the body copy.
					</p>
					{headingBlueprint.length === 0 ? (
						<p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
							{aiReady
								? "No heading blueprint was produced. Regenerate the AI analysis to build one."
								: "Generate the AI analysis to build the recommended heading structure for this page."}
						</p>
					) : (
						<div className="space-y-1.5 text-sm">
							{headingBlueprint.map((h, i) => {
								const s = STATUS_STYLE[h.status];
								const indent = h.level === 1 ? "" : h.level === 2 ? "pl-4" : "pl-8";
								return (
									<div key={i} className={`${indent} border-l border-[var(--color-border)] pl-3`}>
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-mono text-[10px] text-[var(--color-muted)]">H{h.level}</span>
											<span className={h.level === 1 ? "font-semibold" : "font-medium"}>{h.text}</span>
											<span
												className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
												style={{ color: s.color, borderColor: s.color }}
											>
												{s.label}
											</span>
										</div>
										{h.note && <div className="mt-0.5 text-xs text-[var(--color-muted)]">{h.note}</div>}
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}

			{/* b — Schema set (type names only; input to the Schema Generator). */}
			{tab === "schema" && (
				<div className="space-y-3">
					<p className="text-xs text-[var(--color-muted)]">
						The Schema.org types this page should carry — the input set for the Schema Generator above. It only
						emits a type when the page has the content to support it (it never fabricates), so some of these may
						surface as content recommendations instead.
					</p>
					<div className="grid gap-3 sm:grid-cols-2">
						<div>
							<div className="mb-1.5 text-xs font-semibold">Already on the page</div>
							<div className="flex flex-wrap gap-1.5">
								{schemaTypeNames.existing.length === 0 ? (
									<span className="text-xs text-[var(--color-muted)]">None detected.</span>
								) : (
									schemaTypeNames.existing.map(t => (
										<span
											key={t}
											className="rounded-md border border-[var(--color-success)]/50 px-2 py-0.5 text-xs text-[var(--color-success)]"
										>
											{t}
										</span>
									))
								)}
							</div>
						</div>
						<div>
							<div className="mb-1.5 text-xs font-semibold">Recommended to add</div>
							<div className="flex flex-wrap gap-1.5">
								{schemaTypeNames.added.length === 0 ? (
									<span className="text-xs text-[var(--color-muted)]">
										Nothing missing — coverage looks complete.
									</span>
								) : (
									schemaTypeNames.added.map(t => (
										<span
											key={t}
											className="rounded-md border border-[var(--color-accent)]/50 px-2 py-0.5 text-xs text-[var(--color-accent)]"
										>
											{t}
											{t === schemaTypeNames.primary ? " ★" : ""}
										</span>
									))
								)}
							</div>
						</div>
					</div>
					<p className="text-[10px] text-[var(--color-muted)]">★ = primary entity type for this page.</p>
				</div>
			)}

			{/* c — Links the target page has (unchanged). */}
			{tab === "links" && (
				<div className="max-h-[28rem] overflow-auto rounded-md border border-[var(--color-border)]">
					<table className="w-full text-xs">
						<thead className="sticky top-0 bg-[var(--color-surface-2)] text-left">
							<tr>
								<th className="px-3 py-2">Kind</th>
								<th className="px-3 py-2">Anchor</th>
								<th className="px-3 py-2">URL</th>
							</tr>
						</thead>
						<tbody>
							{links.map((l, i) => (
								<tr key={i} className="border-t border-[var(--color-border)]">
									<td className="px-3 py-1.5 text-[var(--color-muted)]">{l.kind}</td>
									<td className="px-3 py-1.5">{l.text || "—"}</td>
									<td className="px-3 py-1.5 font-mono text-[var(--color-accent)] break-all">{l.url}</td>
								</tr>
							))}
						</tbody>
					</table>
					{links.length === 0 && <p className="p-3 text-[var(--color-muted)]">No links parsed.</p>}
				</div>
			)}

			{/* d — Unique items across all pages beneficial for the target. */}
			{tab === "unique" && (
				<div className="space-y-2">
					<p className="text-xs text-[var(--color-muted)]">
						Features the ranking pages ship that this page lacks — concrete things worth pursuing, each sourced to
						the pages that prove it.
					</p>
					{uniqueItems.length === 0 ? (
						<p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
							No clear gaps — this page already matches the ranking pages on the tracked features.
						</p>
					) : (
						<div className="space-y-2">
							{uniqueItems.map((u, i) => (
								<div key={i} className="rounded-md border border-[var(--color-border)] p-3">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<span className="text-sm font-medium">{u.item}</span>
										<span className="text-[10px] text-[var(--color-muted)]">
											{u.presentOn.length} ranking page{u.presentOn.length === 1 ? "" : "s"}
										</span>
									</div>
									<div className="mt-1 text-xs text-[var(--color-muted)]">{u.note}</div>
									<div className="mt-1.5 flex flex-wrap gap-1.5">
										{u.presentOn.map(p => (
											<span
												key={p}
												className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
											>
												{p}
											</span>
										))}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
