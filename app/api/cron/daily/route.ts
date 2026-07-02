import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Daily digest job (SOP 8.1 / 9.2). Schedule this once per morning (Vercel Cron,
 * GitHub Action, or any scheduler) with the header `Authorization: Bearer <CRON_SECRET>`.
 * For each opted-in user it records the best action for the day and, if Resend
 * is configured, emails it.
 */
export async function GET(request: Request) {
	// Auth: require the shared cron secret.
	const auth = request.headers.get("authorization");
	if (!env.cronSecret || auth !== `Bearer ${env.cronSecret}`) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}

	let admin: ReturnType<typeof createServiceClient>;
	try {
		admin = createServiceClient();
	} catch (e) {
		return NextResponse.json({ error: (e as Error).message }, { status: 500 });
	}

	const today = new Date().toISOString().slice(0, 10);

	const { data: profiles } = await admin
		.from("profiles")
		.select("id, email, full_name")
		.eq("daily_digest_optin", true)
		.eq("onboarding_complete", true);

	let processed = 0;
	let emailed = 0;

	for (const p of profiles ?? []) {
		// Skip if today's action already exists.
		const { data: existing } = await admin
			.from("daily_actions")
			.select("id")
			.eq("user_id", p.id)
			.eq("for_date", today)
			.maybeSingle();
		if (existing) continue;

		// Pick the highest-value suggested topic as today's recommended action.
		const { data: topic } = await admin
			.from("topics")
			.select("id, title, rationale, project_id, win_condition")
			.eq("user_id", p.id)
			.eq("status", "suggested")
			.order("score", { ascending: false })
			.limit(1)
			.maybeSingle();

		const title = topic ? `Publish: ${topic.title}` : "Run topic research to unlock today's best action";
		const detail = topic
			? `${topic.rationale ?? ""} (win condition: ${topic.win_condition ?? "mention"})`
			: "Open Topics & Prompts and generate ideas to start your daily cadence.";

		await admin.from("daily_actions").insert({
			user_id: p.id,
			project_id: topic?.project_id ?? null,
			for_date: today,
			action_type: topic ? "publish_topic" : "setup",
			title,
			detail,
			emailed: false,
		});
		processed++;

		// Email it, if Resend + an address are available.
		if (env.resendKey && p.email) {
			try {
				const res = await fetch("https://api.resend.com/emails", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${env.resendKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						from: env.emailFrom,
						to: p.email,
						subject: `Your best GEO action today — ${today}`,
						html: `<h2>${title}</h2><p>${detail}</p><p style="color:#888">Open The First Ranker to act on it.</p>`,
					}),
				});
				if (res.ok) {
					emailed++;
					await admin.from("daily_actions").update({ emailed: true }).eq("user_id", p.id).eq("for_date", today);
				}
			} catch {
				/* email best-effort; the in-app action is already saved */
			}
		}
	}

	return NextResponse.json({ ok: true, processed, emailed, date: today });
}
