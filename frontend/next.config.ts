import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// En production, /api/* est servi par le même domaine (worker.ts). Avec `next dev`, on renvoie
// ces appels vers l'API locale (`wrangler dev` dans backend/).
const nextConfig: NextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/:path*", destination: `${process.env.API_ORIGIN ?? "http://localhost:8787"}/api/:path*` }];
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
