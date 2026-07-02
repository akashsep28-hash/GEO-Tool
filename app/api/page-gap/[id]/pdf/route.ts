/**
 * PDF export endpoint for a stored Page Gap run.
 *
 * Builds the print-quality HTML (lib/page-gap-report-html.ts) and renders it to
 * a real PDF with headless Chrome via Playwright (lib/browser.ts → renderPdf).
 * Using a layout engine instead of hand-written OOXML is what makes the output
 * actually readable. Local-only, like the analyzer itself.
 */
import type { NextRequest } from "next/server";
import { BrowserSession } from "@/lib/browser";
import { buildReportHtml } from "@/lib/page-gap-report-html";
import { getPageGapRun } from "@/lib/page-gap-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function slug(report: { target: { finalUrl: string }; targetUrl: string }): string {
	const raw = report.target.finalUrl || report.targetUrl || "";
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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const run = await getPageGapRun(id);
	if (!run) return new Response("Run not found", { status: 404 });

	const html = buildReportHtml({ report: run.report, llm: run.llm, schema: run.schema });

	const session = new BrowserSession();
	let pdf: Uint8Array;
	try {
		await session.open({});
		pdf = await session.renderPdf(html);
	} catch (e) {
		return new Response(`Could not render PDF: ${(e as Error).message}`, { status: 500 });
	} finally {
		await session.close();
	}

	return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="SEO-Report-${slug(run.report)}.pdf"`,
			"Cache-Control": "no-store",
		},
	});
}
