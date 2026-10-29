import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const dev = process.env.NODE_ENV === "development";

// Politique de contenu : scripts, styles et appels réseau du site seulement (l'API est sur le même domaine).
// 'unsafe-inline' reste nécessaire aux scripts d'amorçage de Next.js ; les images des partenaires sont en https.
// Cloudflare Web Analytics est autorisé au cas où il serait activé sur le domaine.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self' https://cloudflareinsights.com${dev ? " ws:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// En production, /api/* est servi par le même domaine (worker.ts). Avec `next dev`, on renvoie
// ces appels vers l'API locale (`wrangler dev` dans backend/).
const nextConfig: NextConfig = {
  // En-têtes de sécurité : pas d'affichage dans un cadre d'un autre site (clickjacking), pas de devinette du type,
  // HTTPS imposé au navigateur.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/:path*", destination: `${process.env.API_ORIGIN ?? "http://localhost:8787"}/api/:path*` }];
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
