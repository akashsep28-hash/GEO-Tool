import { ConnectionCard } from "@/components/ConnectionCard";
import { listConnections } from "@/lib/connections";
import { CATEGORY_LABELS, type ConnectionCategory, PROVIDERS } from "@/lib/connections-catalog";
import { isDefaultAiConfigured, isEncryptionConfigured } from "@/lib/env";

export default async function SettingsPage() {
	const connections = await listConnections();
	const connectedMap: Record<string, string | null> = {};
	for (const c of connections) connectedMap[c.provider_id] = c.masked_preview;

	const categories = Object.keys(CATEGORY_LABELS) as ConnectionCategory[];

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Settings &amp; API connections</h1>
				<p className="text-[var(--color-muted)]">
					Connect your own tools. Every key is encrypted at rest (AES-256-GCM) and used only to run your workflows
					— it never leaves the server.
				</p>
			</div>

			{!isEncryptionConfigured() && (
				<div className="card p-4 border-[var(--color-warning)]/40">
					<p className="text-sm text-[var(--color-warning)]">
						ENCRYPTION_KEY isn&apos;t set, so connecting APIs is disabled. Add a base64 32-byte key to{" "}
						<code>.env.local</code> and restart.
					</p>
				</div>
			)}

			<div className="card p-4">
				<div className="text-sm">
					Default AI model:{" "}
					{isDefaultAiConfigured() ? (
						<span className="text-[var(--color-success)]">Claude (platform key active)</span>
					) : (
						<span className="text-[var(--color-warning)]">
							none — add an Anthropic key below or set ANTHROPIC_API_KEY
						</span>
					)}
				</div>
			</div>

			{categories.map(cat => {
				const providers = PROVIDERS.filter(p => p.category === cat);
				if (!providers.length) return null;
				return (
					<section key={cat}>
						<h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-3">
							{CATEGORY_LABELS[cat]}
						</h2>
						<div className="grid gap-3">
							{providers.map(p => (
								<ConnectionCard
									key={p.id}
									provider={p}
									connected={p.id in connectedMap}
									maskedPreview={connectedMap[p.id]}
								/>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}
