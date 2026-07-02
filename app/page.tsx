import Link from "next/link";
import { HeroForm } from "@/components/HeroForm";
import { SetupRequired } from "@/components/SetupRequired";
import { isSupabaseConfigured } from "@/lib/env";

const PILLARS = [
	{
		title: "Be the answer & the cited source",
		body: "Optimise to be named in the answer and linked as the source — not just one or the other.",
	},
	{
		title: "Prioritise by value, not volume",
		body: "Prompt-volume data is unreliable. We rank opportunities by buyer value and winnability.",
	},
	{
		title: "Measure citations, not rankings",
		body: "Track mention rate, citation rate, share of voice, and sentiment across every AI engine.",
	},
];

const SECTIONS = [
	["Website Audit", "Automatic GEO + technical audit with exact problems and exact fixes."],
	["Topic & Prompt Research", "Competitor analysis, demand mapping, and a daily best-action email."],
	["Blog Writer", "Long-form content built on the validated GEO tactics."],
	["Design Studio", "Generate on-brand pages and assets formatted for extraction."],
	["Social Repurposing", "Turn each blog into channel-native posts for the right platforms."],
	["Performance Tracker", "GA4, GSC, Ahrefs, SEMrush, Screaming Frog — gaps surfaced automatically."],
];

export default function Home() {
	if (!isSupabaseConfigured()) return <SetupRequired />;

	return (
		<main className="relative min-h-screen overflow-hidden">
			<div className="glow absolute inset-0 pointer-events-none h-[600px]" />

			{/* Nav */}
			<header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
				<div className="font-bold text-lg">
					The First Ranker<span className="text-[var(--color-accent)]">.</span>
				</div>
				<nav className="flex items-center gap-3">
					<Link href="/login" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]">
						Sign in
					</Link>
					<Link href="/login" className="btn btn-ghost px-4 py-2 text-sm">
						Get started
					</Link>
				</nav>
			</header>

			{/* Hero */}
			<section className="relative z-10 max-w-6xl mx-auto px-6 pt-16 pb-20">
				<div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-accent)] border border-[var(--color-border)] rounded-full px-3 py-1">
					Generative Engine Optimization · 2026
				</div>
				<h1 className="text-5xl sm:text-6xl font-bold mt-6 leading-tight max-w-3xl">
					Win the AI answer,
					<br />
					not just the blue link.
				</h1>
				<p className="text-lg text-[var(--color-muted)] mt-5 max-w-2xl">
					89.8% of brands have no measurable AI mentions. Enter your URL and we audit your visibility across
					ChatGPT, Perplexity, Gemini, and Google AI Overviews — then hand you the exact fixes.
				</p>

				<HeroForm />

				<p className="text-xs text-[var(--color-muted)] mt-3">
					Free to start · No sign-up needed to audit · Sign in to save &amp; unlock more
				</p>

				{/* Pillars */}
				<div className="grid sm:grid-cols-3 gap-4 mt-16">
					{PILLARS.map(p => (
						<div key={p.title} className="card p-5">
							<div className="font-semibold">{p.title}</div>
							<div className="text-sm text-[var(--color-muted)] mt-2">{p.body}</div>
						</div>
					))}
				</div>
			</section>

			{/* Sections */}
			<section className="relative z-10 max-w-6xl mx-auto px-6 pb-24">
				<h2 className="text-2xl font-bold">Everything the GEO playbook needs</h2>
				<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
					{SECTIONS.map(([title, body]) => (
						<div key={title} className="card p-5">
							<div className="font-semibold">{title}</div>
							<div className="text-sm text-[var(--color-muted)] mt-2">{body}</div>
						</div>
					))}
				</div>
			</section>

			<footer className="relative z-10 border-t border-[var(--color-border)] py-8 text-center text-xs text-[var(--color-muted)]">
				The First Ranker · Built on the GEO Master SOP · Self-updating
			</footer>
		</main>
	);
}
