import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Server-side Supabase client bound to the request cookies. Respects RLS as the
 * signed-in user. Use this in Server Components, Route Handlers, and Actions.
 */
export async function createClient() {
	const cookieStore = await cookies();

	return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
		cookies: {
			getAll() {
				return cookieStore.getAll();
			},
			setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
				try {
					cookiesToSet.forEach(({ name, value, options }) => {
						cookieStore.set(name, value, options);
					});
				} catch {
					// Called from a Server Component — safe to ignore; middleware refreshes.
				}
			},
		},
	});
}

/**
 * Service-role client that BYPASSES row-level security. Server-only, used by
 * trusted backend jobs (cron digests, webhooks). Never expose to the browser.
 */
export function createServiceClient() {
	if (!env.supabaseServiceKey) {
		throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
	}
	return createAdminClient(env.supabaseUrl, env.supabaseServiceKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}
