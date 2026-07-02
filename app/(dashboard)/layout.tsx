import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { getActor } from "@/lib/actor";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const actor = await getActor();

	let banner: React.ReactNode = null;

	if (actor.kind === "guest") {
		banner = (
			<div className="bg-[var(--color-brand)]/15 border-b border-[var(--color-brand)]/30 px-6 py-2.5 text-sm flex items-center justify-between">
				<span>
					You&apos;re in <strong>guest mode</strong> — the audit works, but sign in to save your data and unlock
					topics, the writer, and tracking.
				</span>
				<Link href="/login" className="btn btn-primary px-3 py-1 text-xs">
					Sign in to save
				</Link>
			</div>
		);
	} else {
		const supabase = await createClient();
		const { data: profile } = await supabase
			.from("profiles")
			.select("onboarding_complete, full_name")
			.eq("id", actor.id)
			.maybeSingle();
		if (profile && !profile.onboarding_complete) {
			banner = (
				<div className="bg-[var(--color-brand)]/15 border-b border-[var(--color-brand)]/30 px-6 py-2.5 text-sm flex items-center justify-between">
					<span>Your setup isn&apos;t finished — some tools stay locked until you connect their APIs.</span>
					<Link href="/onboarding" className="btn btn-primary px-3 py-1 text-xs">
						Resume setup
					</Link>
				</div>
			);
		}
	}

	return (
		<div className="flex min-h-screen">
			<Sidebar />
			<div className="flex-1 min-w-0">
				{banner}
				<div className="p-6 max-w-6xl mx-auto">{children}</div>
			</div>
		</div>
	);
}
