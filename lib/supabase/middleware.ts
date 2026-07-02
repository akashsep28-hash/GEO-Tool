import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env, isSupabaseConfigured } from "@/lib/env";

/**
 * Dual-mode session handling.
 *
 * The app supports a guest mode (no login required), so we NEVER redirect
 * unauthenticated requests away. We still refresh the Supabase auth session on
 * every request when Supabase is configured, so that users who DO sign in keep
 * a valid session. Pages and actions decide per-feature what guests can do.
 */
export async function updateSession(request: NextRequest) {
	let response = NextResponse.next({ request });

	if (!isSupabaseConfigured()) return response;

	const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
		cookies: {
			getAll() {
				return request.cookies.getAll();
			},
			setAll(
				cookiesToSet: {
					name: string;
					value: string;
					options?: Record<string, unknown>;
				}[],
			) {
				cookiesToSet.forEach(({ name, value }) => {
					request.cookies.set(name, value);
				});
				response = NextResponse.next({ request });
				cookiesToSet.forEach(({ name, value, options }) => {
					response.cookies.set(name, value, options);
				});
			},
		},
	});

	// Touch the session so it refreshes if needed. No redirect — guests allowed.
	await supabase.auth.getUser();

	return response;
}
