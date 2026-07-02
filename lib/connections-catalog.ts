/**
 * Catalog of every third-party integration a user can connect themselves.
 * This single source of truth drives the Settings "API connections" vault and
 * the onboarding steps. Each provider declares the credential fields it needs;
 * the values are encrypted at rest (see lib/crypto.ts) and used server-side.
 *
 * Categories map directly to the GEO SOP tool stack (Part 10) and the
 * capabilities the app unlocks once connected.
 */

export type ConnectionCategory =
	| "search_console"
	| "seo_suite"
	| "performance"
	| "serp"
	| "ai_model"
	| "cms"
	| "crm"
	| "social"
	| "email"
	| "developer";

export type CredentialField = {
	key: string;
	label: string;
	type: "text" | "password" | "url" | "textarea";
	placeholder?: string;
	required?: boolean;
};

export type ConnectionProvider = {
	id: string;
	name: string;
	category: ConnectionCategory;
	blurb: string;
	/** Which app capabilities light up when this is connected. */
	unlocks: string[];
	docsUrl: string;
	fields: CredentialField[];
	/** Auth style: api_key (paste a key) or oauth (future: hosted flow). */
	authType: "api_key" | "oauth";
	popular?: boolean;
};

export const CATEGORY_LABELS: Record<ConnectionCategory, string> = {
	search_console: "Search Console & Analytics",
	seo_suite: "SEO Suites",
	performance: "Performance & Crawling",
	serp: "SERP & AI-Visibility",
	ai_model: "AI Models",
	cms: "CMS (publishing)",
	crm: "CRM",
	social: "Social Media",
	email: "Email / Notifications",
	developer: "Developer Options",
};

const KEY_FIELD = (placeholder = "Paste your API key"): CredentialField => ({
	key: "api_key",
	label: "API Key",
	type: "password",
	placeholder,
	required: true,
});

export const PROVIDERS: ConnectionProvider[] = [
	// --- Search Console & Analytics ---
	{
		id: "gsc",
		name: "Google Search Console",
		category: "search_console",
		blurb: "Real query, impression, click, and position data. Feeds the audit and performance tracker.",
		unlocks: ["Website Audit", "Performance Tracker", "Prompt Research"],
		docsUrl: "https://developers.google.com/webmaster-tools",
		authType: "oauth",
		popular: true,
		fields: [
			{
				key: "client_id",
				label: "OAuth Client ID",
				type: "text",
				required: true,
			},
			{
				key: "client_secret",
				label: "OAuth Client Secret",
				type: "password",
				required: true,
			},
			{
				key: "refresh_token",
				label: "Refresh Token",
				type: "password",
				placeholder: "Obtained after the consent flow",
			},
		],
	},
	{
		id: "ga4",
		name: "Google Analytics 4",
		category: "search_console",
		blurb: "Sessions, conversions, and AI-referral traffic. Ties citations to business outcomes (SOP Part 9.3).",
		unlocks: ["Performance Tracker"],
		docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
		authType: "oauth",
		popular: true,
		fields: [
			{ key: "property_id", label: "GA4 Property ID", type: "text", required: true },
			{ key: "client_id", label: "OAuth Client ID", type: "text", required: true },
			{
				key: "client_secret",
				label: "OAuth Client Secret",
				type: "password",
				required: true,
			},
		],
	},
	// --- SEO suites ---
	{
		id: "semrush",
		name: "SEMrush",
		category: "seo_suite",
		blurb: "Keyword research, competitor analysis, and the AI Toolkit.",
		unlocks: ["Prompt Research", "Performance Tracker"],
		docsUrl: "https://developer.semrush.com/api/",
		authType: "api_key",
		popular: true,
		fields: [KEY_FIELD("SEMrush API key")],
	},
	{
		id: "ahrefs",
		name: "Ahrefs",
		category: "seo_suite",
		blurb: "Backlinks, organic keywords, and Brand Radar AI-citation overlap.",
		unlocks: ["Prompt Research", "Performance Tracker", "Website Audit"],
		docsUrl: "https://docs.ahrefs.com/",
		authType: "api_key",
		popular: true,
		fields: [KEY_FIELD("Ahrefs API token")],
	},
	// --- Performance & crawling ---
	{
		id: "pagespeed",
		name: "PageSpeed Insights",
		category: "performance",
		blurb: "Core Web Vitals + Lighthouse field/lab data for every audited page.",
		unlocks: ["Website Audit", "Performance Tracker"],
		docsUrl: "https://developers.google.com/speed/docs/insights/v5/get-started",
		authType: "api_key",
		popular: true,
		fields: [KEY_FIELD("Google API key with PageSpeed enabled")],
	},
	{
		id: "screamingfrog",
		name: "Screaming Frog",
		category: "performance",
		blurb: "Deep crawl exports (now with AI checks). Upload or connect via the CLI.",
		unlocks: ["Website Audit", "Performance Tracker"],
		docsUrl: "https://www.screamingfrog.co.uk/seo-spider/",
		authType: "api_key",
		fields: [KEY_FIELD("License / endpoint token")],
	},
	// --- SERP & AI visibility ---
	{
		id: "serpapi",
		name: "SerpApi",
		category: "serp",
		blurb: "Live SERP, People Also Ask, and AI Overview snapshots.",
		unlocks: ["Prompt Research", "Website Audit"],
		docsUrl: "https://serpapi.com/",
		authType: "api_key",
		popular: true,
		fields: [KEY_FIELD("SerpApi key")],
	},
	{
		id: "dataforseo",
		name: "DataForSEO",
		category: "serp",
		blurb: "SERP, keyword, and AI-visibility data at scale.",
		unlocks: ["Prompt Research", "Performance Tracker"],
		docsUrl: "https://dataforseo.com/apis",
		authType: "api_key",
		fields: [
			{ key: "login", label: "Login", type: "text", required: true },
			{ key: "password", label: "Password", type: "password", required: true },
		],
	},
	// --- AI models ---
	{
		id: "anthropic",
		name: "Anthropic (Claude)",
		category: "ai_model",
		blurb: "Default model for blog writing, audit fixes, and prompt research. Bring your own key to use your own quota.",
		unlocks: ["Blog Writer", "Website Audit", "Prompt Research", "Design"],
		docsUrl: "https://console.anthropic.com/",
		authType: "api_key",
		popular: true,
		fields: [KEY_FIELD("sk-ant-...")],
	},
	{
		id: "local_llm",
		name: "Local LLM (Ollama / LM Studio)",
		category: "ai_model",
		blurb: "Run generation on your own machine for free. Works with any OpenAI-compatible server (Ollama, LM Studio, llama.cpp, vLLM).",
		unlocks: ["Blog Writer", "Website Audit", "Prompt Research", "Design"],
		docsUrl: "https://ollama.com/blog/openai-compatibility",
		authType: "api_key",
		popular: true,
		fields: [
			{
				key: "base_url",
				label: "Base URL",
				type: "url",
				placeholder: "http://localhost:11434/v1  (Ollama) · http://localhost:1234/v1 (LM Studio)",
				required: true,
			},
			{
				key: "model",
				label: "Model name",
				type: "text",
				placeholder: "e.g. llama3.1, qwen2.5, mistral",
				required: true,
			},
			{
				key: "api_key",
				label: "API key (optional — leave blank for Ollama)",
				type: "password",
				placeholder: "Only needed if your server requires it",
			},
		],
	},
	{
		id: "openai",
		name: "OpenAI",
		category: "ai_model",
		blurb: "Alternative model for generation and ChatGPT-visibility checks.",
		unlocks: ["Blog Writer", "Prompt Research"],
		docsUrl: "https://platform.openai.com/",
		authType: "api_key",
		fields: [
			KEY_FIELD("sk-..."),
			{
				key: "model",
				label: "Model (optional)",
				type: "text",
				placeholder: "default: gpt-4o-mini",
			},
		],
	},
	{
		id: "gemini",
		name: "Google Gemini",
		category: "ai_model",
		blurb: "Alternative model + Google AI Overview alignment checks.",
		unlocks: ["Blog Writer", "Prompt Research"],
		docsUrl: "https://ai.google.dev/",
		authType: "api_key",
		fields: [KEY_FIELD("Gemini API key")],
	},
	// --- CMS ---
	{
		id: "wordpress",
		name: "WordPress",
		category: "cms",
		blurb: "Publish optimised posts straight to your site via the REST API.",
		unlocks: ["Blog Writer", "Design"],
		docsUrl: "https://developer.wordpress.org/rest-api/",
		authType: "api_key",
		popular: true,
		fields: [
			{ key: "site_url", label: "Site URL", type: "url", required: true },
			{ key: "username", label: "Username", type: "text", required: true },
			{
				key: "app_password",
				label: "Application Password",
				type: "password",
				required: true,
			},
		],
	},
	{
		id: "webflow",
		name: "Webflow",
		category: "cms",
		blurb: "Push content into Webflow CMS collections.",
		unlocks: ["Blog Writer", "Design"],
		docsUrl: "https://developers.webflow.com/",
		authType: "api_key",
		fields: [KEY_FIELD("Webflow API token")],
	},
	// --- CRM ---
	{
		id: "hubspot",
		name: "HubSpot",
		category: "crm",
		blurb: "Pull sales-call notes & tickets — the richest prompt source (SOP 5.1). Sync content to the CMS.",
		unlocks: ["Prompt Research", "Blog Writer"],
		docsUrl: "https://developers.hubspot.com/",
		authType: "api_key",
		fields: [KEY_FIELD("HubSpot private app token")],
	},
	// --- Social ---
	{
		id: "linkedin",
		name: "LinkedIn",
		category: "social",
		blurb: "Repurpose blogs into LinkedIn posts for the same-day push.",
		unlocks: ["Social Repurposing"],
		docsUrl: "https://learn.microsoft.com/en-us/linkedin/",
		authType: "oauth",
		fields: [KEY_FIELD("Access token")],
	},
	{
		id: "x",
		name: "X (Twitter)",
		category: "social",
		blurb: "Auto-draft threads from each published blog.",
		unlocks: ["Social Repurposing"],
		docsUrl: "https://developer.twitter.com/",
		authType: "oauth",
		fields: [KEY_FIELD("Bearer token")],
	},
	// --- Email ---
	{
		id: "resend",
		name: "Resend",
		category: "email",
		blurb: "Sends the daily 'best topic / best action today' digest (SOP 8.1).",
		unlocks: ["Daily Digest"],
		docsUrl: "https://resend.com/",
		authType: "api_key",
		fields: [KEY_FIELD("re_...")],
	},
	// --- Developer ---
	{
		id: "webhook",
		name: "Outbound Webhook",
		category: "developer",
		blurb: "POST events (audit complete, new topic, citation drop) to any URL.",
		unlocks: ["Developer Options"],
		docsUrl: "#",
		authType: "api_key",
		fields: [
			{ key: "url", label: "Webhook URL", type: "url", required: true },
			{ key: "secret", label: "Signing Secret", type: "password" },
		],
	},
];

export function providerById(id: string): ConnectionProvider | undefined {
	return PROVIDERS.find(p => p.id === id);
}

export function providersByCategory(): Record<ConnectionCategory, ConnectionProvider[]> {
	const grouped = {} as Record<ConnectionCategory, ConnectionProvider[]>;
	for (const p of PROVIDERS) {
		(grouped[p.category] ??= []).push(p);
	}
	return grouped;
}
