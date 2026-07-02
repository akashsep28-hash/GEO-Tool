import { getActor } from "@/lib/actor";
import { listConnections } from "@/lib/connections";
import { getGuestProject } from "@/lib/guest-session";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "./Wizard";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
	const { url } = await searchParams;
	const actor = await getActor();

	// Guest mode: no login wall. Connections are an account feature, so the guest
	// wizard simply runs the audit on the entered URL.
	if (actor.kind === "guest") {
		const guestProject = await getGuestProject();
		return (
			<OnboardingWizard
				initialUrl={guestProject?.website_url ?? url ?? ""}
				initialIndustry={guestProject?.industry ?? ""}
				connectedMap={{}}
				isGuest
			/>
		);
	}

	const supabase = await createClient();
	const { data: project } = await supabase
		.from("projects")
		.select("website_url, name, industry")
		.eq("is_primary", true)
		.maybeSingle();

	const connections = await listConnections();
	const connectedMap: Record<string, string | null> = {};
	for (const c of connections) connectedMap[c.provider_id] = c.masked_preview;

	return (
		<OnboardingWizard
			initialUrl={project?.website_url ?? url ?? ""}
			initialIndustry={project?.industry ?? ""}
			connectedMap={connectedMap}
		/>
	);
}
