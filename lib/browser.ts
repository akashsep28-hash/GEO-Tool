/**
 * Browser automation layer for the Page Gap Analyzer.
 *
 * Drives the user's own installed Chrome through Playwright (`channel: "chrome"`)
 * exactly as the build spec describes — no bundled browser binary is downloaded.
 * A single BrowserSession is opened per analysis run and reused for the SERP
 * fetch plus all 11 page visits, then closed.
 *
 * This is the only place that talks to Playwright. Everything downstream works
 * on plain rendered HTML, which is then parsed by the existing audit-engine
 * parser (lib/audit-engine.ts → analyzeRenderedHtml).
 */
import "server-only";
import type { Browser, BrowserContext, Page } from "playwright-core";

const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 700;

const DESKTOP_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_UA =
	"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

export type DeviceMode = "desktop" | "mobile";

export type RenderedPage = {
	requestedUrl: string;
	finalUrl: string;
	status: number;
	ok: boolean;
	html: string;
	error?: string;
};

/** Random 2–5s delay between page visits, per the spec's politeness guardrail. */
export function politeDelay(): Promise<void> {
	const ms = 2000 + Math.floor(Math.random() * 3000);
	return new Promise(resolve => setTimeout(resolve, ms));
}

export class BrowserSession {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private device: DeviceMode = "desktop";

	async open(opts: { device?: DeviceMode; locale?: string; interactive?: boolean } = {}): Promise<void> {
		this.device = opts.device ?? "desktop";
		let chromium: typeof import("playwright-core").chromium;
		try {
			({ chromium } = await import("playwright-core"));
		} catch {
			throw new Error("Playwright is not installed. Run `npm install playwright-core`.");
		}

		try {
			this.browser = await chromium.launch({
				channel: "chrome",
				// Interactive mode opens a visible window so the user can clear a
				// Google bot check; otherwise run headless.
				headless: !opts.interactive,
				args: ["--disable-blink-features=AutomationControlled"],
			});
		} catch (e) {
			throw new Error(
				`Could not launch Chrome via Playwright (channel: "chrome"). Make sure Google Chrome is installed on this machine. Original error: ${(e as Error).message}`,
			);
		}

		this.context = await this.browser.newContext({
			userAgent: this.device === "mobile" ? MOBILE_UA : DESKTOP_UA,
			viewport: this.device === "mobile" ? { width: 412, height: 915 } : { width: 1366, height: 900 },
			locale: opts.locale ?? "en-US",
			isMobile: this.device === "mobile",
			extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
		});
		this.context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
		// Light stealth: hide the automation flag most bot checks read first.
		await this.context.addInitScript(() => {
			Object.defineProperty(navigator, "webdriver", { get: () => undefined });
		});
		// Pre-seed Google's consent cookie so the SERP renders results directly
		// instead of a "Before you continue" interstitial.
		await this.context.addCookies([
			{
				name: "SOCS",
				value: "CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgLC_pwY",
				domain: ".google.com",
				path: "/",
			},
			{
				name: "CONSENT",
				value: "YES+cb.20210720-07-p0.en+FX+410",
				domain: ".google.com",
				path: "/",
			},
		]);
	}

	/** Run a callback with a fresh page that is always closed afterward. */
	async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
		if (!this.context) throw new Error("Browser session is not open.");
		const page = await this.context.newPage();
		try {
			return await fn(page);
		} finally {
			await page.close().catch(() => {});
		}
	}

	/** Navigate to a URL and return its fully rendered HTML. Never throws. */
	async fetchRendered(url: string): Promise<RenderedPage> {
		if (!this.context) {
			return {
				requestedUrl: url,
				finalUrl: url,
				status: 0,
				ok: false,
				html: "",
				error: "Browser session is not open.",
			};
		}
		try {
			return await this.withPage(async page => {
				let status = 0;
				try {
					const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
					status = resp?.status() ?? 0;
				} catch (e) {
					// Navigation timeout still often leaves usable DOM; capture what we have.
					status = 0;
					void e;
				}
				await page.waitForTimeout(SETTLE_MS);
				const html = await page.content();
				const finalUrl = page.url();
				const ok = html.length > 0 && (status === 0 || (status >= 200 && status < 400));
				return { requestedUrl: url, finalUrl, status, ok, html };
			});
		} catch (e) {
			return {
				requestedUrl: url,
				finalUrl: url,
				status: 0,
				ok: false,
				html: "",
				error: (e as Error).message,
			};
		}
	}

	/**
	 * Render a self-contained HTML document to a PDF (headless Chromium only —
	 * page.pdf() is unavailable in headed mode, so never call this on a session
	 * opened with interactive:true). Returns the PDF bytes.
	 */
	async renderPdf(html: string): Promise<Uint8Array> {
		if (!this.context) throw new Error("Browser session is not open.");
		return await this.withPage(async page => {
			await page.setContent(html, { waitUntil: "networkidle" });
			return await page.pdf({
				format: "A4",
				printBackground: true,
				displayHeaderFooter: true,
				margin: { top: "14mm", bottom: "16mm", left: "13mm", right: "13mm" },
				headerTemplate: "<span></span>",
				footerTemplate:
					`<div style="font-size:8px;color:#9aa5a0;width:100%;padding:0 13mm;display:flex;justify-content:space-between">` +
					`<span>First Ranker · Page Gap Report</span>` +
					`<span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
			});
		});
	}

	async close(): Promise<void> {
		await this.context?.close().catch(() => {});
		await this.browser?.close().catch(() => {});
		this.context = null;
		this.browser = null;
	}
}
