// Point d'entrée du Worker du site : /api/* va à l'API (liaison de service API → zedeka-api),
// le reste au site Next.js construit par OpenNext. La requête passe telle quelle, en-têtes compris
// (dont le jeton Cloudflare Access que l'API vérifie pour l'admin).

// @ts-expect-error -- fichier produit par `opennextjs-cloudflare build`
import { default as site } from "./.open-next/worker.js";

type Ctx = { waitUntil(promise: Promise<unknown>): void };

// Photos des plats et publicités (/api/media/…) : leur nom est aléatoire et leur contenu ne change jamais. Gardées dans
// le cache Cloudflare du point de présence, elles partent de là sans réveiller l'API ni relire R2 pour chaque client.
const EDGE_CACHED = /^\/api\/media\/menu-images\//;

async function fromEdgeCache(request: Request, env: CloudflareEnv, ctx: Ctx): Promise<Response> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return env.API.fetch(request);
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return hit;
  const response = await env.API.fetch(request);
  if (response.status === 200 && /immutable/.test(response.headers.get("Cache-Control") ?? "")) {
    ctx.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  }
  return response;
}

export default {
  fetch(request: Request, env: CloudflareEnv, ctx: Ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && EDGE_CACHED.test(pathname)) return fromEdgeCache(request, env, ctx);
    if (pathname === "/api" || pathname.startsWith("/api/")) return env.API.fetch(request);
    return site.fetch(request, env, ctx);
  },
};
