/**
 * Server-side data access for the BYO-API connection vault.
 * Handles encryption on write and decryption on read. Plaintext secrets never
 * leave the server.
 */
import "server-only";
import { providerById } from "@/lib/connections-catalog";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { createClient } from "@/lib/supabase/server";

export type ConnectionRow = {
	id: string;
	provider_id: string;
	category: string;
	label: string | null;
	masked_preview: string | null;
	status: string;
	last_verified_at: string | null;
	created_at: string;
};

/** List the current user's connections (no secrets included). */
export async function listConnections(): Promise<ConnectionRow[]> {
	const supabase = await createClient();
	const { data, error } = await supabase
		.from("connections")
		.select("id, provider_id, category, label, masked_preview, status, last_verified_at, created_at")
		.order("created_at", { ascending: true });
	if (error) throw error;
	return data ?? [];
}

/** Set of connected provider ids (for gating capabilities in the UI). */
export async function connectedProviderIds(): Promise<Set<string>> {
	const rows = await listConnections();
	return new Set(rows.map(r => r.provider_id));
}

/** Upsert a connection, encrypting all credential fields into one blob. */
export async function saveConnection(providerId: string, credentials: Record<string, string>): Promise<void> {
	const provider = providerById(providerId);
	if (!provider) throw new Error(`Unknown provider: ${providerId}`);

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) throw new Error("Not authenticated.");

	// Validate required fields.
	for (const f of provider.fields) {
		if (f.required && !credentials[f.key]?.trim()) {
			throw new Error(`Missing required field: ${f.label}`);
		}
	}

	const encrypted = encryptSecret(JSON.stringify(credentials));
	const primary =
		credentials.api_key ||
		credentials.app_password ||
		credentials.client_secret ||
		Object.values(credentials)[0] ||
		"";

	const { error } = await supabase.from("connections").upsert(
		{
			user_id: user.id,
			provider_id: providerId,
			category: provider.category,
			label: provider.name,
			encrypted_credentials: encrypted,
			masked_preview: maskSecret(primary),
			status: "connected",
			updated_at: new Date().toISOString(),
		},
		{ onConflict: "user_id,provider_id" },
	);
	if (error) throw error;
}

/** Decrypt a single connection's credentials for server-side use. */
export async function getCredentials(providerId: string): Promise<Record<string, string> | null> {
	const supabase = await createClient();
	const { data, error } = await supabase
		.from("connections")
		.select("encrypted_credentials")
		.eq("provider_id", providerId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return JSON.parse(decryptSecret(data.encrypted_credentials));
}

export async function deleteConnection(providerId: string): Promise<void> {
	const supabase = await createClient();
	const { error } = await supabase.from("connections").delete().eq("provider_id", providerId);
	if (error) throw error;
}
