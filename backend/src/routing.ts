// Itinéraire pour l'écran « Naviguer » des livreurs et conducteurs Zed : tracé, distance, durée et manœuvres
// (tourner à gauche, rond-point…). Service compatible OSRM (réseau routier d'OpenStreetMap) ; adresse fixée par
// ROUTING_URL, jamais choisie par le visiteur. Sans réponse, l'écran trace une ligne droite vers l'arrivée.

import type { LatLng } from "./mapsLink.js";

export type RouteFetcher = (url: string, init: RequestInit) => Promise<Response>;

// Serveur de démonstration du projet OSRM : à remplacer par notre propre serveur (ROUTING_URL) quand le trafic grandit.
export const DEFAULT_ROUTING_URL = "https://router.project-osrm.org";

export type RouteStep = {
  // depart, turn, new name, continue, merge, fork, end of road, roundabout, rotary, exit roundabout, arrive…
  type: string;
  // left, right, slight left, sharp right, straight, uturn
  modifier: string | null;
  // Nom de la rue empruntée après la manœuvre (souvent vide à Lomé).
  name: string;
  // Sortie à prendre au rond-point.
  exit: number | null;
  // Point de la manœuvre, et distance parcourue sur l'étape qui suit.
  latitude: number;
  longitude: number;
  distanceM: number;
};

export type Route = { distanceM: number; durationS: number; line: [number, number][]; steps: RouteStep[] };

type OsrmStep = {
  distance: number;
  name?: string;
  maneuver: { type: string; modifier?: string; exit?: number; location: [number, number] };
};
type OsrmResponse = { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: OsrmStep[] }[] }[] };

export const validPoint = (p: LatLng) =>
  Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && !(p.latitude === 0 && p.longitude === 0);

// « 6.1319,1.2123 » → point, ou null.
export function parsePoint(text: unknown): LatLng | null {
  if (typeof text !== "string") return null;
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const p = { latitude: Number(m[1]), longitude: Number(m[2]) };
  return validPoint(p) ? p : null;
}

export function kmBetween(a: LatLng, b: LatLng) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Une course se fait en ville : au-delà, c'est une erreur de point et on n'interroge pas le service.
export const MAX_ROUTE_KM = 150;

// Même trajet demandé par plusieurs livreurs ou en rafale (recalcul) : réponse gardée quelques minutes.
const cache = new Map<string, { at: number; route: Route }>();
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 500;
const key = (p: LatLng) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;

export function clearRouteCache() {
  cache.clear();
}

export async function fetchRoute(from: LatLng, to: LatLng, opts: { baseUrl?: string; fetcher?: RouteFetcher } = {}): Promise<Route | null> {
  const k = `${key(from)};${key(to)}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.route;

  const base = (opts.baseUrl || DEFAULT_ROUTING_URL).replace(/\/+$/, "");
  const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const url = `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=false`;
  const res = await (opts.fetcher ?? fetch)(url, { headers: { "User-Agent": "Zedeka/1.0 (livraison a Lome)" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Itinéraire indisponible (${res.status})`);
  const body = (await res.json()) as OsrmResponse;
  const r = body.code === "Ok" ? body.routes?.[0] : undefined;
  if (!r) return null;

  const route: Route = {
    distanceM: Math.round(r.distance),
    durationS: Math.round(r.duration),
    // GeoJSON donne [longitude, latitude] ; la carte attend [latitude, longitude].
    line: r.geometry.coordinates.map(([lng, lat]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]),
    steps: r.legs.flatMap((leg) =>
      leg.steps.map((s) => ({
        type: s.maneuver.type,
        modifier: s.maneuver.modifier ?? null,
        name: s.name ?? "",
        exit: s.maneuver.exit ?? null,
        latitude: Number(s.maneuver.location[1].toFixed(6)),
        longitude: Number(s.maneuver.location[0].toFixed(6)),
        distanceM: Math.round(s.distance),
      })),
    ),
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(k, { at: Date.now(), route });
  return route;
}
