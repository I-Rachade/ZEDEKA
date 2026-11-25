// Point d'entrée du Worker du site : /api/* va à l'API (liaison de service API → zedeka-api),
// le reste au site Next.js construit par OpenNext. La requête passe telle quelle, en-têtes compris
// (dont le jeton Cloudflare Access que l'API vérifie pour l'admin).

// @ts-expect-error -- fichier produit par `opennextjs-cloudflare build`
import { default as site } from "./.open-next/worker.js";

type Ctx = { waitUntil(promise: Promise<unknown>): void };

// Photos des plats et publicités (/api/media/…) : leur nom est aléatoire et leur contenu ne change jamais. Gardées dans
// le cache Cloudflare du point de présence, elles partent de là sans réveiller l'API ni relire R2 pour chaque client.
// Tuiles du fond de carte (/api/carte/{z}/{x}/{y}.mvt) : même traitement, gardées une journée.
const EDGE_CACHED = /^\/api\/(media\/menu-images\/|carte\/\d)/;
// Données publiques qui changent rarement (zones, règles d'annulation, catégories de colis) : gardées 60 s au point de
// présence (en-tête Cache-Control posé par l'API), une copie par langue puisque l'API traduit ses réponses.
const EDGE_SHORT = /^\/api\/(zones|policies|parcel-categories|carte\/info)$/;

function langOf(request: Request): "fr" | "en" {
  const header = request.headers.get("x-lang");
  if (header === "en" || header === "fr") return header;
  return /(?:^|;\s*)lang=en(?:;|$)/.test(request.headers.get("cookie") ?? "") ? "en" : "fr";
}

async function fromEdgeCache(request: Request, env: CloudflareEnv, ctx: Ctx, perLang = false): Promise<Response> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return env.API.fetch(request);
  const url = new URL(request.url);
  if (perLang) url.searchParams.set("_lang", langOf(request));
  const key = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return hit;
  const response = await env.API.fetch(request);
  const control = response.headers.get("Cache-Control") ?? "";
  if (response.status === 200 && /immutable|public, max-age=\d+/.test(control) && !/no-store|private/.test(control)) {
    ctx.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  }
  return response;
}

// Photos des plats rangées avec le site (public/photos-plats, en .jpg dans les liens enregistrés) : chacune a sa
// copie .webp. Le navigateur qui annonce le WebP la reçoit, les autres gardent le JPEG ; même adresse pour tous.
async function negotiatedPhoto(request: Request, env: CloudflareEnv): Promise<Response> {
  const url = new URL(request.url);
  if (/\.jpe?g$/i.test(url.pathname) && /image\/webp/.test(request.headers.get("accept") ?? "")) {
    const webp = await env.ASSETS.fetch(new Request(url.toString().replace(/\.jpe?g$/i, ".webp"), { method: request.method }));
    if (webp.ok) {
      const response = new Response(webp.body, webp);
      response.headers.set("Content-Type", "image/webp");
      response.headers.set("Vary", "Accept");
      response.headers.set("Cache-Control", "public, max-age=604800");
      return response;
    }
  }
  const response = await env.ASSETS.fetch(request);
  const out = new Response(response.body, response);
  out.headers.set("Vary", "Accept");
  if (response.ok) out.headers.set("Cache-Control", "public, max-age=604800");
  return out;
}

export default {
  fetch(request: Request, env: CloudflareEnv, ctx: Ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && pathname.startsWith("/photos-plats/")) return negotiatedPhoto(request, env);
    if (request.method === "GET" && EDGE_CACHED.test(pathname)) return fromEdgeCache(request, env, ctx);
    if (request.method === "GET" && EDGE_SHORT.test(pathname)) return fromEdgeCache(request, env, ctx, true);
    if (pathname === "/api" || pathname.startsWith("/api/")) return env.API.fetch(request);
    return site.fetch(request, env, ctx);
  },
};
