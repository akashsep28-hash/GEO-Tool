"use server";

import { revalidatePath } from "next/cache";
import { generateText } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";

async function getUserAndProject() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) throw new Error("Not authenticated.");
	const { data: project } = await supabase
		.from("projects")
		.select("id, name, website_url, industry")
		.eq("is_primary", true)
		.maybeSingle();
	if (!project) throw new Error("No project found. Add your website first.");
	return { supabase, user, project };
}

const GEO_SYSTEM = `You are a Generative Engine Optimization (GEO) strategist trained on a rigorous SOP. Durable rules you always follow:
- Be the answer AND the cited source.
- Prioritise by buyer value, not search volume (prompt-volume data is unreliable).
- Engines read 500-800 token chunks, not whole pages: every passage must be self-contained.
- Open with the answer in the first 50-80 words (inverse pyramid: answer, evidence, nuance).
- Add specific statistics, named expert quotations, and inline citations to credible sources (the three validated tactics).
- Include a structured comparison table where the topic invites comparison.
- Use the current year signal where freshness matters.
- No keyword stuffing, no padding, no empty persuasive language (these failed in testing).`;

/** Generate prioritised topic ideas and store them. */
export async function generateTopicsAction(): Promise<{
	ok: boolean;
	error?: string;
	count?: number;
}> {
	try {
		const { supabase, user, project } = await getUserAndProject();
		const prompt = `Website: ${project.website_url}
Industry: ${project.industry || "unspecified"}

Propose 8 high-value GEO content topics for this brand. For each, map it to the buyer journey and judge whether it is winnable (does the prompt trigger a web search with brand/source citations?).

Return STRICT JSON, an array of objects with keys:
"title" (string), "cluster" (short topic-cluster name), "win_condition" ("mention" or "citation"), "score" (0-100 buyer-value/winnability), "rationale" (one sentence). No prose outside the JSON.`;

		const raw = await generateText({
			system: GEO_SYSTEM,
			prompt,
			maxTokens: 2000,
		});
		const json = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
		const items = JSON.parse(json) as Array<{
			title: string;
			cluster?: string;
			win_condition?: string;
			score?: number;
			rationale?: string;
		}>;

		const rows = items.slice(0, 12).map(t => ({
			user_id: user.id,
			project_id: project.id,
			title: String(t.title).slice(0, 300),
			cluster: t.cluster ?? null,
			win_condition: t.win_condition ?? null,
			score: typeof t.score === "number" ? Math.round(t.score) : null,
			rationale: t.rationale ?? null,
			status: "suggested",
		}));
		if (rows.length) {
			const { error } = await supabase.from("topics").insert(rows);
			if (error) return { ok: false, error: error.message };
		}
		revalidatePath("/topics");
		return { ok: true, count: rows.length };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

/** Write a GEO-optimised draft for a topic/title and store it. */
export async function generateBlogAction(
	title: string,
	topicId?: string,
): Promise<{ ok: boolean; error?: string; contentId?: string }> {
	try {
		const { supabase, user, project } = await getUserAndProject();
		if (!title.trim()) return { ok: false, error: "A title is required." };

		const body = await generateText({
			system: GEO_SYSTEM,
			prompt: `Write a complete, publish-ready article in Markdown for "${project.name}" (${project.website_url}, industry: ${project.industry || "general"}).

Title: ${title}

Requirements:
- Open with a 50-80 word quick-answer paragraph that directly answers the primary question.
- Use clear question-style H2/H3 headings; keep each section self-contained.
- Include at least one structured comparison table.
- Include specific statistics and at least two inline source citations (markdown links).
- Add a short FAQ section mapping to real prompts.
- Include the current year where freshness matters.
- No fluff, no keyword stuffing.`,
			maxTokens: 4000,
		});

		const { data, error } = await supabase
			.from("content_pieces")
			.insert({
				user_id: user.id,
				project_id: project.id,
				topic_id: topicId ?? null,
				title: title.trim(),
				body,
				status: "draft",
			})
			.select("id")
			.single();
		if (error) return { ok: false, error: error.message };
		revalidatePath("/writer");
		return { ok: true, contentId: data.id };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

/** Repurpose an existing draft into channel-native social posts. */
export async function repurposeSocialAction(
	contentId: string,
	platforms: string[],
): Promise<{ ok: boolean; error?: string; count?: number }> {
	try {
		const { supabase, user } = await getUserAndProject();
		const { data: piece } = await supabase
			.from("content_pieces")
			.select("id, title, body")
			.eq("id", contentId)
			.maybeSingle();
		if (!piece) return { ok: false, error: "Draft not found." };

		const rows: {
			user_id: string;
			content_piece_id: string;
			platform: string;
			body: string;
			status: string;
		}[] = [];
		for (const platform of platforms) {
			const text = await generateText({
				system: GEO_SYSTEM,
				prompt: `Repurpose this article into a single ${platform} post that is native to that platform's format and tone. Keep the core factual hook and one statistic. No hashtags spam.

Title: ${piece.title}

Article:
${(piece.body ?? "").slice(0, 6000)}`,
				maxTokens: 800,
			});
			rows.push({
				user_id: user.id,
				content_piece_id: piece.id,
				platform,
				body: text,
				status: "draft",
			});
		}
		if (rows.length) {
			const { error } = await supabase.from("social_posts").insert(rows);
			if (error) return { ok: false, error: error.message };
		}
		revalidatePath("/social");
		return { ok: true, count: rows.length };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
