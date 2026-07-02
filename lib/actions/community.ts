"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createCommunityPost(title: string, body: string): Promise<{ ok: boolean; error?: string }> {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { ok: false, error: "Not authenticated." };
	if (!title.trim() || !body.trim()) return { ok: false, error: "Title and body are required." };

	const authorName = (user.user_metadata?.full_name as string) || user.email?.split("@")[0] || "Member";

	const { error } = await supabase.from("community_posts").insert({
		user_id: user.id,
		author_name: authorName,
		title: title.trim(),
		body: body.trim(),
	});
	if (error) return { ok: false, error: error.message };
	revalidatePath("/community");
	return { ok: true };
}
