/**
 * Streaming endpoint for the standalone Schema Generator.
 *
 * Same work as generateSchemaForUrlAction (render page → plan → extract →
 * assemble; nothing persisted), but streams NDJSON activity so the button can
 * narrate the Chrome render and each agent live. The final "done" event
 * carries the SchemaGenResult for the client to display.
 */
import type { NextRequest } from "next/server";
import { withAgentEvents } from "@/lib/agent-runner";
import type { DeviceMode } from "@/lib/browser";
import { generateSchemaForUrl } from "@/lib/schema-generator";

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

type Body = { url?: string; keyword?: string; country?: string; device?: DeviceMode };

export async function POST(req: NextRequest) {
	const body = (await req.json().catch(() => ({}))) as Body;
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
			try {
				const url = normaliseInputUrl(body.url ?? "");
				if (!url) {
					send({ type: "error", error: "Enter a valid page URL." });
					return;
				}

				const result = await withAgentEvents(
					e => send({ type: "activity", ...e }),
					() =>
						generateSchemaForUrl(url, {
							keyword: body.keyword,
							country: body.country,
							device: body.device,
						}),
				);

				if (!result.meta.ok) {
					send({
						type: "error",
						error: "The page could not be fetched. Check the URL is public and reachable, then try again.",
					});
					return;
				}

				send({ type: "done", result });
			} catch (e) {
				send({ type: "error", error: (e as Error).message });
			} finally {
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
