import { getCloudflareContext } from "@opennextjs/cloudflare";

// Lectures de l'API depuis les pages rendues côté serveur. Sur Cloudflare, par la liaison de service API
// (sans passer par Internet) ; avec `next dev`, sur l'API locale (`wrangler dev`, port 8787 par défaut).
const LOCAL_API = process.env.API_ORIGIN ?? "http://localhost:8787";

async function apiFetch(path: string): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true }).catch(() => ({ env: {} as Partial<CloudflareEnv> }));
  if (env.API) return env.API.fetch(new Request(`https://zedeka.poinderecharge.com${path}`));
  return fetch(`${LOCAL_API}${path}`, { cache: "no-store" });
}

// Renvoie null si la ressource n'existe pas (404).
export async function serverGet<T>(path: string): Promise<T | null> {
  const res = await apiFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} sur ${path}`);
  return res.json() as Promise<T>;
}
