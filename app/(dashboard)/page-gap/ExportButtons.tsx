"use client";

import { useState } from "react";
import { buildHtmlZip, type ExportInput, toCsv, toJson, toMarkdown } from "@/lib/page-gap-export";

function bytesToArrayBuffer(u8: Uint8Array): ArrayBuffer {
	return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function download(filename: string, content: BlobPart, mime: string) {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function pageSlug(data: ExportInput): string {
	const raw = data.report.target.finalUrl || data.report.targetUrl || "";
	let s = raw;
	try {
		const u = new URL(raw);
		s = (u.hostname + u.pathname).replace(/\/+$/, "");
	} catch {
		/* fall back to the raw string */
	}
	return (
		s
			.replace(/[^a-z0-9.-]+/gi, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "report"
	);
}

export function ExportButtons({ data, runId }: { data: ExportInput; runId: string }) {
	// Filenames reference the page (URL), not the keyword.
	const base = `SEO-Report-${pageSlug(data)}`;
	const htmlCount = (data.report.target?.html ? 1 : 0) + data.report.competitors.filter(c => c.html).length;
	const hasAi = !!data.llm;
	const [pdfState, setPdfState] = useState<"idle" | "loading" | "error">("idle");

	const downloadPdf = async () => {
		setPdfState("loading");
		try {
			const res = await fetch(`/api/page-gap/${runId}/pdf`);
			if (!res.ok) throw new Error(await res.text());
			const blob = await res.blob();
			download(`${base}.pdf`, blob, "application/pdf");
			setPdfState("idle");
		} catch {
			setPdfState("error");
		}
	};

	return (
		<div className="flex flex-wrap gap-2">
			<button
				className="btn btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
				onClick={downloadPdf}
				disabled={pdfState === "loading"}
				title={
					hasAi
						? "Render the full report (with AI analysis) as a print-quality PDF"
						: "Render the report as a print-quality PDF (generate AI analysis first for the full version)"
				}
			>
				{pdfState === "loading"
					? "⏳ Rendering PDF…"
					: pdfState === "error"
						? "⚠ Retry PDF"
						: `⬇ Report (PDF)${hasAi ? "" : " — pre-AI"}`}
			</button>
			{htmlCount > 0 && (
				<button
					className="btn btn-ghost px-3 py-1.5 text-xs"
					onClick={() =>
						download(`${base}-html.zip`, bytesToArrayBuffer(buildHtmlZip(data.report)), "application/zip")
					}
					title={`Download parsed HTML for all ${htmlCount} pages as a ZIP`}
				>
					⬇ HTML ZIP ({htmlCount})
				</button>
			)}
			<button
				className="btn btn-ghost px-3 py-1.5 text-xs"
				onClick={() => download(`${base}.json`, toJson(data), "application/json")}
			>
				Export JSON
			</button>
			<button
				className="btn btn-ghost px-3 py-1.5 text-xs"
				onClick={() => download(`${base}.md`, toMarkdown(data), "text/markdown")}
			>
				Export Markdown
			</button>
			<button
				className="btn btn-ghost px-3 py-1.5 text-xs"
				onClick={() => download(`${base}-gaps.csv`, toCsv(data), "text/csv")}
			>
				Export CSV
			</button>
		</div>
	);
}
