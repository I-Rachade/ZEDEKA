// Recherche d'un lieu pour la carte : un lien Google Maps (ou des coordonnées) donne directement le point ;
// sinon un nom de lieu (quartier, rue, marché, pharmacie…) est cherché dans OpenStreetMap (Nominatim), au Togo,
// en privilégiant Lomé. Seul ce service est appelé, jamais une adresse choisie par le visiteur.
import { isShortMapsLink, type LatLng, parseMapsLink, resolveMapsLink } from "./mapsLink.js";

export type Place = LatLng & { name: string; detail: string };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// Grand Lomé (ouest, nord, est, sud) : résultats proposés en premier, sans exclure le reste du pays.
const LOME_BOX = "0.95,6.35,1.45,6.05";

export const looksLikeLink = (q: string) => /^https?:\/\//i.test(q.trim()) || parseMapsLink(q) !== null;

export async function searchPlaces(q: string, fetcher: Fetcher = fetch): Promise<Place[]> {
  const text = q.trim();
  if (looksLikeLink(text) || isShortMapsLink(text)) {
    const p = await resolveMapsLink(text, fetcher);
    return p ? [{ ...p, name: "Lien Google Maps", detail: `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` }] : [];
  }
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q: text, format: "jsonv2", countrycodes: "tg", limit: "6", "accept-language": "fr", viewbox: LOME_BOX, bounded: "0" });
  const res = await fetcher(url, {
    headers: { "User-Agent": "Zedeka/1.0 (livraison a Lome; contact: zedeka.poinderecharge.com)" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Recherche indisponible (${res.status})`);
  const rows = (await res.json()) as { lat: string; lon: string; name?: string; display_name?: string }[];
  return rows
    .map((r) => {
      const parts = (r.display_name ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const name = r.name || parts[0] || text;
      return {
        latitude: Number(r.lat),
        longitude: Number(r.lon),
        name,
        // Quartier et ville, sans le pays ni le nom déjà affiché.
        detail: parts.filter((p) => p !== name && p !== "Togo").slice(0, 3).join(", "),
      };
    })
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
}
