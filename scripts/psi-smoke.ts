/**
 * PageSpeed Insights smoke test. Reads PAGESPEED_API_KEY from the environment
 * (never hardcoded). Run: PAGESPEED_API_KEY=… npx tsx scripts/psi-smoke.ts [url]
 */
import { fetchPageSpeed } from "@/lib/pagespeed";

const url = process.argv[2] || "https://en.wikipedia.org/wiki/Loan";

(async () => {
	console.log(`Fetching PSI (mobile) for ${url} …`);
	const r = await fetchPageSpeed(url, { strategy: "mobile" });
	console.log("fetched:", r.fetched, r.error ? `(error: ${r.error})` : "");
	console.log("field source:", r.field.source);
	console.log("  LCP:", r.field.lcpMs);
	console.log("  INP:", r.field.inpMs);
	console.log("  CLS:", r.field.cls);
	console.log("lab perf score:", r.lab?.performanceScore ?? "—");
	if (r.lab) {
		for (const [id, a] of Object.entries(r.lab.audits)) {
			console.log(`  audit ${id}: score=${a.score} ${a.displayValue ?? ""}`);
		}
	}
})();
