"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ConnectionCard } from "@/components/ConnectionCard";
import { runAuditAction } from "@/lib/actions/audit";
import { completeOnboardingAction, saveProjectAction } from "@/lib/actions/project";
import { PROVIDERS } from "@/lib/connections-catalog";

const INDUSTRIES = [
	"SaaS / Software",
	"E-commerce",
	"Local / Brick-and-mortar",
	"Agency / Services",
	"Publisher / Media",
	"Healthcare",
	"Finance",
	"Other",
];

type StepKey = "website" | "analytics" | "seo" | "ai" | "review";

const STEPS: { key: StepKey; title: string; subtitle: string; providerIds?: string[] }[] = [
	{
		key: "website",
		title: "Your website",
		subtitle: "This is the site we audit and optimise for AI visibility.",
	},
	{
		key: "analytics",
		title: "Search Console & Analytics",
		subtitle:
			"Connect Google's data so the audit and tracker use your real numbers. Skip to use crawl-only data for now.",
		providerIds: ["gsc", "ga4", "pagespeed"],
	},
	{
		key: "seo",
		title: "SEO & SERP data",
		subtitle: "Power competitor analysis, keyword findings, and AI-visibility tracking. All optional.",
		providerIds: ["semrush", "ahrefs", "serpapi", "dataforseo"],
	},
	{
		key: "ai",
		title: "AI model & notifications",
		subtitle:
			"Use a free local model (Ollama / LM Studio), bring your own OpenAI/Claude key, or rely on the built-in default. Add Resend for the daily email.",
		providerIds: ["local_llm", "anthropic", "openai", "resend"],
	},
	{
		key: "review",
		title: "Run your first audit",
		subtitle: "We'll crawl your site and surface the exact GEO problems and fixes.",
	},
];

export function OnboardingWizard({
	initialUrl,
	initialIndustry,
	connectedMap,
	isGuest = false,
}: {
	initialUrl: string;
	initialIndustry: string;
	connectedMap: Record<string, string | null>;
	isGuest?: boolean;
}) {
	const router = useRouter();
	const [step, setStep] = useState(0);
	const [url, setUrl] = useState(initialUrl);
	const [industry, setIndustry] = useState(initialIndustry);
	const [savingProject, setSavingProject] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [finishing, setFinishing] = useState(false);

	// Guests skip the API-connection steps (those require an account) and go
	// straight from the website step to running the audit.
	const steps = useMemo(
		() => (isGuest ? STEPS.filter(s => s.key === "website" || s.key === "review") : STEPS),
		[isGuest],
	);

	const current = steps[step];
	const progress = Math.round(((step + 1) / steps.length) * 100);
	const connectedCount = useMemo(() => Object.keys(connectedMap).length, [connectedMap]);

	async function nextFromWebsite() {
		setSavingProject(true);
		setError(null);
		const res = await saveProjectAction({ websiteUrl: url, industry });
		setSavingProject(false);
		if (!res.ok) {
			setError(res.error ?? "Could not save your website.");
			return;
		}
		setStep(1);
	}

	async function finish() {
		setFinishing(true);
		setError(null);
		// Guests have no profile to mark complete; skip that step for them.
		if (!isGuest) await completeOnboardingAction();
		// Kick off the first audit (uses crawl-only data; no APIs required).
		const res = await runAuditAction();
		if (!res.ok) {
			setFinishing(false);
			setError(res.error ?? "Audit could not start.");
			return;
		}
		router.push("/audit");
	}

	return (
		<main className="min-h-screen relative">
			<div className="glow absolute inset-0 pointer-events-none h-[300px]" />

			{/* Progress bar (always visible at top) */}
			<div className="sticky top-0 z-20 bg-[var(--color-bg)]/90 backdrop-blur border-b border-[var(--color-border)]">
				<div className="max-w-3xl mx-auto px-6 py-4">
					<div className="flex items-center justify-between text-sm">
						<span className="font-semibold">Setup</span>
						<span className="text-[var(--color-muted)]">
							Step {step + 1} of {steps.length}
							{!isGuest && ` · ${connectedCount} APIs connected`}
						</span>
					</div>
					<div className="mt-2 h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
						<div
							className="h-full transition-all"
							style={{
								width: `${progress}%`,
								background: "linear-gradient(90deg, var(--color-brand), var(--color-brand-2))",
							}}
						/>
					</div>
					<div className="mt-2 flex gap-1">
						{steps.map((s, i) => (
							<button
								key={s.key}
								onClick={() => i <= step && setStep(i)}
								className={`text-[10px] uppercase tracking-wide ${
									i === step
										? "text-[var(--color-fg)]"
										: i < step
											? "text-[var(--color-success)]"
											: "text-[var(--color-muted)]"
								}`}
							>
								{s.title}
								{i < steps.length - 1 ? " ›" : ""}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="max-w-3xl mx-auto px-6 py-10 relative z-10">
				<h1 className="text-2xl font-bold">{current.title}</h1>
				<p className="text-[var(--color-muted)] mt-1">{current.subtitle}</p>

				{/* WEBSITE STEP */}
				{current.key === "website" && (
					<div className="card p-6 mt-6 space-y-4">
						<div>
							<label className="text-xs text-[var(--color-muted)]">
								Website URL <span className="text-[var(--color-danger)]">*</span>
							</label>
							<input
								className="input mt-1"
								placeholder="yourwebsite.com"
								value={url}
								onChange={e => setUrl(e.target.value)}
							/>
						</div>
						<div>
							<label className="text-xs text-[var(--color-muted)]">
								Industry (tailors topic & social recommendations)
							</label>
							<select className="input mt-1" value={industry} onChange={e => setIndustry(e.target.value)}>
								<option value="">Select…</option>
								{INDUSTRIES.map(i => (
									<option key={i} value={i}>
										{i}
									</option>
								))}
							</select>
						</div>
						{error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
						<div className="flex justify-end">
							<button
								onClick={nextFromWebsite}
								disabled={savingProject || !url.trim()}
								className="btn btn-primary px-5 py-2.5"
							>
								{savingProject ? "Saving…" : "Continue →"}
							</button>
						</div>
					</div>
				)}

				{/* CONNECTION STEPS */}
				{current.providerIds && (
					<>
						<div className="grid gap-3 mt-6">
							{current.providerIds.map(pid => {
								const provider = PROVIDERS.find(p => p.id === pid)!;
								return (
									<ConnectionCard
										key={pid}
										provider={provider}
										connected={pid in connectedMap}
										maskedPreview={connectedMap[pid]}
									/>
								);
							})}
						</div>
						<div className="flex items-center justify-between mt-6">
							<button onClick={() => setStep(s => s - 1)} className="btn btn-ghost px-4 py-2">
								← Back
							</button>
							<div className="flex items-center gap-3">
								<button
									onClick={() => setStep(s => s + 1)}
									className="text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
								>
									Skip this step
								</button>
								<button onClick={() => setStep(s => s + 1)} className="btn btn-primary px-5 py-2.5">
									Continue →
								</button>
							</div>
						</div>
						<p className="text-xs text-[var(--color-muted)] mt-3">
							Skipping is fine — these features simply stay locked until you connect the relevant API, which you
							can do anytime in Settings.
						</p>
					</>
				)}

				{/* REVIEW STEP */}
				{current.key === "review" && (
					<div className="card p-6 mt-6">
						<p className="text-sm">
							You&apos;re set up. We&apos;ll run an automatic GEO audit of{" "}
							<span className="font-mono text-[var(--color-accent)]">{url}</span> right now — no API keys
							required for the crawl-based checks. Findings come with the exact fix for each.
						</p>
						<ul className="text-sm text-[var(--color-muted)] mt-4 space-y-1 list-disc list-inside">
							<li>AI crawler access (the #1 silent killer)</li>
							<li>llms.txt, schema stack, server-side rendering</li>
							<li>Answer-first formatting, statistics &amp; citation density</li>
							<li>Comparison tables, freshness/year signals</li>
						</ul>
						{error && <p className="text-sm text-[var(--color-danger)] mt-4">{error}</p>}
						<div className="flex items-center justify-between mt-6">
							<button onClick={() => setStep(s => s - 1)} className="btn btn-ghost px-4 py-2">
								← Back
							</button>
							<button onClick={finish} disabled={finishing} className="btn btn-primary px-6 py-2.5">
								{finishing ? "Running audit…" : "Finish & run audit →"}
							</button>
						</div>
					</div>
				)}
			</div>
		</main>
	);
}
