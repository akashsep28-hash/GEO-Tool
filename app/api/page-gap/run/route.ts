/**
 * Streaming Page Gap run endpoint.
 *
 * The deterministic run takes ~30–90s (it drives a real Chrome through the SERP
 * and 11 pages). A server action gives no feedback during that time, so this
 * route runs the same pipeline but streams NDJSON progress events as each stage
 * completes — that powers the real-time loading bar under the Run button. On
 * completion it persists the run and emits the new run id for the client to
 * navigate to.
 */

import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { getActor } from "@/lib/actor";
import type { DeviceMode } from "@/lib/browser";
import { ensureGuestId } from "@/lib/guest-session";
import { type ProgressEvent, runPageGap } from "@/lib/page-gap-run";
import { savePageGapRun } from "@/lib/page-gap-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function normaliseInputUrl(raw: string): string | null {
	const s = (raw ?? "").trim();
	if (!s) return null;
	try {
		const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
		return new URL(withProto).toString();
	} catch {
		return null;
	}
}

type Body = {
	url?: string;
	keyword?: string;
	country?: string;
	device?: DeviceMode;
	interactive?: boolean;
};

export async function POST(req: NextRequest) {
	const body = (await req.json().catch(() => ({}))) as Body;
	const encoder = new TextEncoder();

	// A streamed response body cannot set cookies once it has started flushing.
	// For guests, the run is keyed by the guest cookie — so ensure it exists and
	// is attached to THIS response now, before streaming, or the saved run would
	// be orphaned (signed-in users are keyed by user_id and are unaffected).
	const actor = await getActor();
	if (actor.kind === "guest") {
		await ensureGuestId();
	}

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));

			try {
				const url = normaliseInputUrl(body.url ?? "");
				if (!url) {
					send({ type: "error", error: "Enter a valid target page URL." });
					return;
				}
				const keyword = (body.keyword ?? "").trim();
				if (!keyword) {
					send({ type: "error", error: "Enter a target keyword." });
					return;
				}

				const result = await runPageGap(url, keyword, {
					country: body.country,
					device: body.device,
					interactive: body.interactive,
					onProgress: (e: ProgressEvent) => send({ type: "progress", ...e }),
				});

				if (result.serp.results.length === 0) {
					send({
						type: "error",
						error:
							result.serp.error ??
							"The SERP returned no organic results, so there are no competitors to source gaps from.",
					});
					return;
				}

				const runId = await savePageGapRun(result);
				revalidatePath("/page-gap");
				send({ type: "done", runId });
			} catch (e) {
				send({ type: "error", error: (e as Error).message });
			} finally {
				// Close exactly once. Early returns above fall through to here.
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
