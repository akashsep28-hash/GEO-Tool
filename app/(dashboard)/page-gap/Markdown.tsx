import React from "react";

/**
 * Minimal, safe inline-markdown renderer for LLM output.
 *
 * The model frequently emits **bold**, *italic*, `code`, and [links](url).
 * Rendering those strings verbatim left literal `**` on screen. This parses the
 * common inline tokens into React nodes (no dangerouslySetInnerHTML, so it is
 * XSS-safe) and is intentionally small — block-level markdown is handled by the
 * surrounding <ul>/<p> structure, this only fixes inline formatting.
 */

// Order matters: links first, then code, then bold (** or __), then italic.
const TOKEN = /(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g;

export function renderInline(text: string): React.ReactNode[] {
	const nodes: React.ReactNode[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	let key = 0;
	TOKEN.lastIndex = 0;
	while ((m = TOKEN.exec(text))) {
		if (m.index > last) nodes.push(text.slice(last, m.index));
		const tok = m[0];
		if (m[1]) {
			const inner = tok.slice(1, tok.indexOf("]"));
			const href = tok.slice(tok.indexOf("](") + 2, -1);
			nodes.push(
				<a
					key={key++}
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className="text-[var(--color-accent)] underline"
				>
					{inner}
				</a>,
			);
		} else if (m[2]) {
			nodes.push(
				<code key={key++} className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[0.85em]">
					{tok.slice(1, -1)}
				</code>,
			);
		} else if (m[3] || m[4]) {
			nodes.push(
				<strong key={key++} className="font-semibold text-[var(--color-fg)]">
					{tok.slice(2, -2)}
				</strong>,
			);
		} else {
			nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
		}
		last = m.index + tok.length;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}

/** Inline markdown as a <span> (use inside list items / sentences). */
export function Md({ children }: { children: string }) {
	return <>{renderInline(children ?? "")}</>;
}

/**
 * Block markdown: splits on blank lines into paragraphs and renders inline
 * formatting inside each. Use for multi-line narrative sections.
 */
export function MdBlock({ text, className = "" }: { text: string; className?: string }) {
	const paras = (text ?? "").split(/\n{2,}/).filter(p => p.trim());
	if (!paras.length) return null;
	return (
		<div className={`space-y-2 ${className}`}>
			{paras.map((p, i) => (
				<p key={i} className="whitespace-pre-line">
					{p.split(/\n/).map((line, j) => (
						<React.Fragment key={j}>
							{j > 0 && <br />}
							{renderInline(line.replace(/^[-*•]\s+/, "• "))}
						</React.Fragment>
					))}
				</p>
			))}
		</div>
	);
}
