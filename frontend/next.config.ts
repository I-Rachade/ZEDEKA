import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;

// Politique de contenu : scripts et styles du site uniquement, appels réseau vers l'API seulement.
// 'unsafe-inline' reste nécessaire aux scripts d'amorçage de Next.js ; les images des partenaires sont en https.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${api}`,
  "font-src 'self'",
  `connect-src 'self' ${api}${dev ? " ws:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // En-têtes de sécurité : pas d'affichage dans un cadre d'un autre site (clickjacking), pas de devinette du type,
  // HTTPS imposé au navigateur (ignoré tant que le site est servi en http, en local).
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
};

export default nextConfig;
