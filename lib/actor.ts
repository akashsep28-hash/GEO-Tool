import "server-only";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * The "current actor" — either a signed-in Supabase user or an anonymous guest.
 *
 * Guest mode lets visitors try the core flow (enter a URL → run an audit → see
 * the fixes) without signing in. Guest data lives in a cookie-keyed in-memory
 * store (lib/guest-session.ts), not in the database. As soon as a user signs in,
 * the same code paths persist to Supabase instead.
 */
export type Actor = { kind: "user"; id: string } | { kind: "guest" };

export async function getActor(): Promise<Actor> {
	if (!isSupabaseConfigured()) return { kind: "guest" };
	try {
		const supabase = await createClient();
		const {
			data: { user },
		} = await supabase.auth.getUser();
		if (user) return { kind: "user", id: user.id };
	} catch {
		/* Supabase unreachable — fall back to guest */
	}
	return { kind: "guest" };
}
