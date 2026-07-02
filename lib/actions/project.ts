"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/actor";
import { saveGuestProject } from "@/lib/guest-session";
import { createClient } from "@/lib/supabase/server";

export type ProjectResult = { ok: boolean; error?: string; projectId?: string };

/** Create (or update the primary) project for the current user OR guest. */
export async function saveProjectAction(input: {
	websiteUrl: string;
	name?: string;
	industry?: string;
}): Promise<ProjectResult> {
	try {
		let url = input.websiteUrl.trim();
		if (!url) return { ok: false, error: "Website URL is required." };
		if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
		let host: string;
		try {
			host = new URL(url).host;
		} catch {
			return { ok: false, error: "That doesn't look like a valid URL." };
		}

		const actor = await getActor();

		// Guest: persist to the cookie-keyed session store, not the database.
		if (actor.kind === "guest") {
			await saveGuestProject({
				websiteUrl: url,
				name: input.name || host,
				industry: input.industry ?? null,
			});
			revalidatePath("/dashboard");
			return { ok: true, projectId: "guest" };
		}

		const supabase = await createClient();

		const { data: existing } = await supabase.from("projects").select("id").eq("is_primary", true).maybeSingle();

		if (existing) {
			const { error } = await supabase
				.from("projects")
				.update({
					website_url: url,
					name: input.name || host,
					industry: input.industry ?? null,
				})
				.eq("id", existing.id);
			if (error) return { ok: false, error: error.message };
			revalidatePath("/dashboard");
			return { ok: true, projectId: existing.id };
		}

		const { data, error } = await supabase
			.from("projects")
			.insert({
				user_id: actor.id,
				website_url: url,
				name: input.name || host,
				industry: input.industry ?? null,
				is_primary: true,
			})
			.select("id")
			.single();
		if (error) return { ok: false, error: error.message };
		revalidatePath("/dashboard");
		return { ok: true, projectId: data.id };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export async function completeOnboardingAction(): Promise<{ ok: boolean }> {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { ok: false };
	await supabase.from("profiles").update({ onboarding_complete: true }).eq("id", user.id);
	revalidatePath("/dashboard");
	return { ok: true };
}
