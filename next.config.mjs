import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	poweredByHeader: false,
	// A stray package-lock.json in the parent folder (D:\Office) makes Turbopack
	// infer the wrong workspace root, which desyncs the React Client Manifest and
	// throws "Could not find the module … in the React Client Manifest". Pin the
	// root to THIS project so client components resolve correctly.
	turbopack: { root: projectRoot },
	// playwright-core spawns the system Chrome at runtime; keep it external so Next
	// does not try to bundle the driver into the server build.
	serverExternalPackages: ["playwright-core"],
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=()",
					},
				],
			},
		];
	},
};

export default nextConfig;
