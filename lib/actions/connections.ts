"use server";

import { revalidatePath } from "next/cache";
import { deleteConnection, saveConnection } from "@/lib/connections";
import { isEncryptionConfigured } from "@/lib/env";

export type ActionResult = { ok: boolean; error?: string };

export async function saveConnectionAction(
	providerId: string,
	credentials: Record<string, string>,
): Promise<ActionResult> {
	try {
		if (!isEncryptionConfigured()) {
			return {
				ok: false,
				error: "ENCRYPTION_KEY is not set. Add a base64 32-byte key to .env.local before connecting APIs.",
			};
		}
		await saveConnection(providerId, credentials);
		revalidatePath("/settings");
		revalidatePath("/onboarding");
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export async function deleteConnectionAction(providerId: string): Promise<ActionResult> {
	try {
		await deleteConnection(providerId);
		revalidatePath("/settings");
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
