// Point d'entrée du Worker du site : /api/* va à l'API (liaison de service API → zedeka-api),
// le reste au site Next.js construit par OpenNext. La requête passe telle quelle, en-têtes compris
// (dont le jeton Cloudflare Access que l'API vérifie pour l'admin).

// @ts-expect-error -- fichier produit par `opennextjs-cloudflare build`
import { default as site } from "./.open-next/worker.js";

export default {
  fetch(request: Request, env: CloudflareEnv, ctx: unknown): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) return env.API.fetch(request);
    return site.fetch(request, env, ctx);
  },
};
