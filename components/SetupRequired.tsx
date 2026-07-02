/**
 * Shown when the app boots without Supabase configured. Keeps the app runnable
 * out-of-the-box (local-first) and tells the user exactly what to do next.
 */
export function SetupRequired() {
	const steps = [
		{
			title: "1 · Install & run",
			body: "You already did this. The app is live on localhost — it just needs credentials to unlock auth and data.",
		},
		{
			title: "2 · Create a Supabase project",
			body: "Go to supabase.com → New project. Open Project Settings → API and copy the Project URL, anon key, and service_role key.",
		},
		{
			title: "3 · Run the database migration",
			body: "In Supabase → SQL Editor, paste the contents of supabase/migrations/0001_init.sql and run it.",
		},
		{
			title: "4 · Enable Google sign-in",
			body: "Supabase → Authentication → Providers → Google. Add your Google OAuth client ID/secret and the callback URL shown there.",
		},
		{
			title: "5 · Fill .env.local",
			body: "Copy .env.example to .env.local, paste your Supabase keys, generate an ENCRYPTION_KEY, and add your ANTHROPIC_API_KEY. Restart the dev server.",
		},
	];

	return (
		<main className="min-h-screen flex items-center justify-center p-6">
			<div className="glow absolute inset-0 pointer-events-none" />
			<div className="card max-w-2xl w-full p-8 relative">
				<div className="text-sm font-semibold text-[var(--color-accent)]">The First Ranker · GEO Tool</div>
				<h1 className="text-3xl font-bold mt-2">Almost ready — 5 quick steps</h1>
				<p className="text-[var(--color-muted)] mt-2">
					The app is running, but it needs Supabase + an AI key before sign-in and the GEO engine come online.
					Follow these once:
				</p>
				<ol className="mt-6 space-y-4">
					{steps.map(s => (
						<li key={s.title} className="flex gap-4">
							<div className="mt-1 h-2 w-2 rounded-full bg-[var(--color-brand)] shrink-0" />
							<div>
								<div className="font-semibold">{s.title}</div>
								<div className="text-sm text-[var(--color-muted)]">{s.body}</div>
							</div>
						</li>
					))}
				</ol>
				<div className="mt-6 text-xs text-[var(--color-muted)] border-t border-[var(--color-border)] pt-4">
					Full instructions are in <code>README.md</code>. After restarting, this screen disappears automatically.
				</div>
			</div>
		</main>
	);
}
