"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
	{ href: "/dashboard", label: "Dashboard", icon: "◧" },
	{ href: "/audit", label: "Website Audit", icon: "⚑" },
	{ href: "/page-gap", label: "Page Gap Analyzer", icon: "⊞" },
	{ href: "/schema", label: "Schema Generator", icon: "⟨⟩" },
	{ href: "/topics", label: "Topics & Prompts", icon: "✦" },
	{ href: "/writer", label: "Blog Writer", icon: "✎" },
	{ href: "/design", label: "Design Studio", icon: "◳" },
	{ href: "/social", label: "Social Repurposing", icon: "⤳" },
	{ href: "/performance", label: "Performance", icon: "↗" },
	{ href: "/community", label: "Community", icon: "◎", free: true },
];

export function Sidebar() {
	const pathname = usePathname();
	return (
		<aside className="w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col h-screen sticky top-0">
			<Link href="/dashboard" className="px-5 py-5 font-bold text-lg">
				First Ranker<span className="text-[var(--color-accent)]">.</span>
			</Link>
			<nav className="flex-1 px-3 space-y-1 overflow-y-auto">
				{NAV.map(n => {
					const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
					return (
						<Link
							key={n.href}
							href={n.href}
							className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
								active
									? "bg-[var(--color-surface-2)] text-[var(--color-fg)] font-semibold"
									: "text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
							}`}
						>
							<span className="w-4 text-center opacity-80">{n.icon}</span>
							{n.label}
							{n.free && <span className="ml-auto text-[9px] uppercase text-[var(--color-success)]">free</span>}
						</Link>
					);
				})}
			</nav>
			<div className="px-3 py-3 border-t border-[var(--color-border)]">
				<Link
					href="/settings"
					className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
						pathname.startsWith("/settings")
							? "bg-[var(--color-surface-2)] font-semibold"
							: "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
					}`}
				>
					<span className="w-4 text-center">⚙</span> Settings & APIs
				</Link>
				<form action="/auth/signout" method="post">
					<button className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]">
						<span className="w-4 text-center">⎋</span> Sign out
					</button>
				</form>
			</div>
		</aside>
	);
}
