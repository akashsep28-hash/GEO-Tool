"use server";

import type { DeviceMode } from "@/lib/browser";
import { generateSchemaForUrl, type SchemaGenResult } from "@/lib/schema-generator";

function normaliseInputUrl(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;
	try {
		const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
		return new URL(withProto).toString();
	} catch {
		return null;
	}
}

export type GenerateSchemaActionResult = {
	ok: boolean;
	error?: string;
	result?: SchemaGenResult;
};

/** Render a URL and generate Schema.org JSON-LD for it (no persistence). */
export async function generateSchemaForUrlAction(input: {
	url: string;
	keyword?: string;
	country?: string;
	device?: DeviceMode;
}): Promise<GenerateSchemaActionResult> {
	try {
		const url = normaliseInputUrl(input.url);
		if (!url) return { ok: false, error: "Enter a valid page URL." };

		const result = await generateSchemaForUrl(url, {
			keyword: input.keyword,
			country: input.country,
			device: input.device,
		});

		if (!result.meta.ok) {
			return {
				ok: false,
				error: "The page could not be fetched. Check the URL is public and reachable, then try again.",
			};
		}

		return { ok: true, result };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
