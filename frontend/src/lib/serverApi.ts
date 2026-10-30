import { getCloudflareContext } from "@opennextjs/cloudflare";
import { connection } from "next/server";
import { getLang } from "@/lib/i18n/server";

// Lectures de l'API depuis les pages rendues côté serveur. Sur Cloudflare, par la liaison de service API
// (sans passer par Internet) ; avec `next dev`, sur l'API locale (`wrangler dev`, port 8787 par défaut).
const LOCAL_API = process.env.API_ORIGIN ?? "http://localhost:8787";

async function apiFetch(path: string): Promise<Response> {
  // Rendu à chaque visite : sans ça, `next build` pré-rend les pages sans paramètre (/colis, /app/aide…)
  // et appelle l'API pendant le build, où elle n'est pas joignable.
  await connection();
  const { env } = await getCloudflareContext({ async: true }).catch(() => ({ env: {} as Partial<CloudflareEnv> }));
  // Langue du visiteur, pour les textes renvoyés par l'API (disponibilité d'un restaurant, erreurs…).
  const headers = { "x-lang": await getLang() };
  // Avec `next dev` et API_ORIGIN, toujours l'API locale indiquée : la liaison de service passerait par le registre
  // de wrangler, qui peut encore désigner une instance arrêtée (tests de bout en bout, e2e/).
  const local = process.env.NODE_ENV === "development" && !!process.env.API_ORIGIN;
  if (env.API && !local) return env.API.fetch(new Request(`https://zedeka.poinderecharge.com${path}`, { headers }));
  return fetch(`${LOCAL_API}${path}`, { cache: "no-store", headers });
}

// Renvoie null si la ressource n'existe pas (404).
export async function serverGet<T>(path: string): Promise<T | null> {
  const res = await apiFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} sur ${path}`);
  return res.json() as Promise<T>;
}
