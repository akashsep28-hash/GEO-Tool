import Link from "next/link";
import { Suspense } from "react";
import { LoginButtons } from "./LoginButtons";

export default function LoginPage() {
	return (
		<main className="min-h-screen flex items-center justify-center p-6 relative">
			<div className="glow absolute inset-0 pointer-events-none" />
			<div className="card max-w-md w-full p-8 relative">
				<Link href="/" className="font-bold text-lg">
					The First Ranker<span className="text-[var(--color-accent)]">.</span>
				</Link>
				<h1 className="text-2xl font-bold mt-6">Sign in to continue</h1>
				<p className="text-sm text-[var(--color-muted)] mt-2">
					We sign you in with Google so your projects, API keys, and reports stay in your own account.
				</p>

				<Suspense fallback={<div className="mt-8 h-12" />}>
					<LoginButtons />
				</Suspense>

				<p className="text-xs text-[var(--color-muted)] mt-6">
					By continuing you agree that your connected API keys are encrypted at rest and used only to run your GEO
					workflows.
				</p>
			</div>
		</main>
	);
}
