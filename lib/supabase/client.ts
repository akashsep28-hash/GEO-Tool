"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/** Browser-side Supabase client (uses the public anon key + RLS). */
export function createClient() {
	return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
