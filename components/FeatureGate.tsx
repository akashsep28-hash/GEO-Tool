import Link from "next/link";

/** Renders a "connect an API to unlock" notice for skipped onboarding steps. */
export function FeatureGate({
	title,
	providers,
	children,
}: {
	title: string;
	providers: string[];
	children?: React.ReactNode;
}) {
	return (
		<div className="card p-6 border-dashed">
			<div className="text-sm font-semibold">{title} is locked</div>
			<p className="text-sm text-[var(--color-muted)] mt-1">
				Connect {providers.join(" or ")} to enable this. Your onboarding let you skip it — you can add it anytime.
			</p>
			{children}
			<Link href="/settings" className="btn btn-primary px-4 py-2 text-sm mt-4 inline-flex">
				Connect in Settings →
			</Link>
		</div>
	);
}
