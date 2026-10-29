// Lien Google Maps collé par un client pour indiquer un point : on en tire la latitude et la longitude.
// Les liens courts (maps.app.goo.gl, partagés depuis le téléphone) sont suivis côté serveur pour lire leur
// redirection ; seuls ces hôtes sont appelés, jamais une adresse choisie par le visiteur.

export type LatLng = { latitude: number; longitude: number };

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";

// Formes reconnues, de la plus précise à la moins précise : !3d…!4d… (épingle), q= / query= / ll= / destination=,
// @lat,lng (centre de la vue), et des coordonnées tapées telles quelles.
export function parseMapsLink(text: string): LatLng | null {
  let t = text.trim();
  try {
    t = decodeURIComponent(t);
  } catch {
    // Lien mal encodé : on cherche dans le texte brut.
  }
  t = t.replace(/\+/g, " ");
  const patterns = [
    new RegExp(`!3d${NUM}!4d${NUM}`),
    new RegExp(`[?&](?:q|query|ll|destination|daddr)=(?:loc:)?\\s*${NUM}\\s*,\\s*${NUM}`),
    new RegExp(`/search/${NUM}\\s*,\\s*${NUM}`),
    new RegExp(`@${NUM},${NUM}`),
    new RegExp(`^${NUM}\\s*[,;]\\s*${NUM}$`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (valid(lat, lng)) return { latitude: lat, longitude: lng };
    }
  }
  return null;
}

const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl"];

export function isShortMapsLink(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === "https:" && SHORT_HOSTS.includes(u.hostname) && (u.hostname !== "goo.gl" || u.pathname.startsWith("/maps"));
  } catch {
    return false;
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// Suit au plus 3 redirections, en restant sur les domaines de Google, et lit la position dans l'adresse finale.
export async function resolveMapsLink(text: string, fetcher: Fetcher = fetch): Promise<LatLng | null> {
  const direct = parseMapsLink(text);
  if (direct || !isShortMapsLink(text)) return direct;
  let url = text.trim();
  for (let i = 0; i < 3; i++) {
    const res = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const next = res.headers.get("location");
    if (!next) return null;
    const found = parseMapsLink(next);
    if (found) return found;
    const host = new URL(next, url).hostname;
    if (!/(^|\.)(google\.[a-z.]+|goo\.gl)$/.test(host)) return null;
    url = new URL(next, url).toString();
  }
  return null;
}
