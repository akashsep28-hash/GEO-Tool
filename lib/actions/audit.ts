"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/actor";
import { runAudit } from "@/lib/audit-engine";
import { saveAuditPages } from "@/lib/audit-pages";
import { getGuestProject, saveGuestAudit } from "@/lib/guest-session";
import { createClient } from "@/lib/supabase/server";

export type AuditActionResult = {
	ok: boolean;
	error?: string;
	auditId?: string;
};

/** Run a fresh GEO audit for the current user's OR guest's primary project. */
export async function runAuditAction(): Promise<AuditActionResult> {
	try {
		const actor = await getActor();

		// Guest: run the audit and store it in the cookie-keyed session.
		if (actor.kind === "guest") {
			const guestProject = await getGuestProject();
			if (!guestProject) {
				return { ok: false, error: "No project found. Add your website first." };
			}
			const result = await runAudit(guestProject.website_url);
			await saveGuestAudit(result);
			revalidatePath("/audit");
			revalidatePath("/dashboard");
			return { ok: true, auditId: "guest" };
		}

		const supabase = await createClient();

		const { data: project } = await supabase
			.from("projects")
			.select("id, website_url")
			.eq("is_primary", true)
			.maybeSingle();
		if (!project) {
			return { ok: false, error: "No project found. Add your website first." };
		}

		const result = await runAudit(project.website_url);

		const { data: audit, error: auditErr } = await supabase
			.from("audits")
			.insert({
				user_id: actor.id,
				project_id: project.id,
				status: "complete",
				score: result.score,
				summary: { ...result.stats, dimensions: result.dimensions },
			})
			.select("id")
			.single();
		if (auditErr) return { ok: false, error: auditErr.message };

		const findings = result.findings.map(f => ({
			audit_id: audit.id,
			user_id: actor.id,
			severity: f.severity,
			category: f.category,
			title: f.title,
			problem: f.problem,
			fix: f.fix,
			evidence: f.evidence ?? null,
			sop_ref: f.sop_ref ?? null,
			dimension: f.dimension,
		}));
		if (findings.length) {
			const { error: fErr } = await supabase.from("audit_findings").insert(findings);
			if (fErr) return { ok: false, error: fErr.message };
		}

		// Persist the full per-page records (HTML + signals) for the AI agent.
		await saveAuditPages(audit.id, actor.id, result.pages);

		revalidatePath("/audit");
		revalidatePath("/dashboard");
		return { ok: true, auditId: audit.id };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
