import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "The First Ranker — GEO Tool",
	description:
		"Be the answer and the cited source. Automatic GEO audits, prompt research, content, and AI-visibility tracking across ChatGPT, Perplexity, Gemini, and Google AI Overviews.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			{/* Browser extensions (Grammarly, password managers, etc.) inject
			    attributes onto <body> before React hydrates; suppress the benign
			    hydration warning that causes. */}
			<body suppressHydrationWarning>{children}</body>
		</html>
	);
}
