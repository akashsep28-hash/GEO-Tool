import { getActor } from "@/lib/actor";
import { getGuestProject } from "@/lib/guest-session";
import { createClient } from "@/lib/supabase/server";
import { SchemaGeneratorClient } from "./SchemaGeneratorClient";

export default async function SchemaGeneratorPage() {
	const actor = await getActor();

	let defaultUrl = "";
	if (actor.kind === "guest") {
		const gp = await getGuestProject();
		defaultUrl = gp?.website_url ?? "";
	} else {
		const supabase = await createClient();
		const { data: p } = await supabase.from("projects").select("website_url").eq("is_primary", true).maybeSingle();
		defaultUrl = p?.website_url ?? "";
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Schema Generator</h1>
				<p className="text-[var(--color-muted)]">
					Paste any URL and get standards-correct Schema.org JSON-LD. It preserves the page’s existing structured
					data, adds the types its page type needs, and grounds every value in the page’s own content — no SERP run
					required.
				</p>
			</div>

			<SchemaGeneratorClient defaultUrl={defaultUrl} />
		</div>
	);
}
