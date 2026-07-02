/**
 * Centralised environment access + "is the app configured yet?" checks.
 * The app is local-first: it must boot and render a helpful setup screen even
 * when Supabase / AI keys are not yet provided.
 */

export const env = {
	siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
	supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
	supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
	supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
	encryptionKey: process.env.ENCRYPTION_KEY ?? "",
	anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
	// Env-level local LLM (Ollama / LM Studio). Lets guests + the default path use
	// a local model without a per-user connection. e.g. http://localhost:11434/v1
	localLlmBaseUrl: process.env.LOCAL_LLM_BASE_URL ?? "",
	localLlmModel: process.env.LOCAL_LLM_MODEL ?? "",
	localLlmApiKey: process.env.LOCAL_LLM_API_KEY ?? "",
	// Smaller local model to fall back to when the primary local model fails/OOMs
	// (e.g. the Schema Generator retry). Must be pulled on the same local server.
	localLlmFallbackModel: process.env.LOCAL_LLM_FALLBACK_MODEL ?? "gemma3:4b",
	resendKey: process.env.RESEND_API_KEY ?? "",
	emailFrom: process.env.EMAIL_FROM ?? "GEO Tool <noreply@example.com>",
	cronSecret: process.env.CRON_SECRET ?? "",
};

/** Supabase is the minimum required to enable auth + persistence. */
export function isSupabaseConfigured(): boolean {
	return Boolean(env.supabaseUrl?.startsWith("http") && env.supabaseAnonKey);
}

/** Whether the server can encrypt user secrets at rest. */
export function isEncryptionConfigured(): boolean {
	try {
		return Buffer.from(env.encryptionKey, "base64").length === 32;
	} catch {
		return false;
	}
}

/** Whether the platform-default Claude model is available. */
export function isDefaultAiConfigured(): boolean {
	return env.anthropicKey.startsWith("sk-ant-");
}
