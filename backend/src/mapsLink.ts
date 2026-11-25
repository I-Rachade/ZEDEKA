// Lien Google Maps collé par un client pour indiquer un point : on en tire la latitude et la longitude.
// Les liens courts (maps.app.goo.gl, share.google…, partagés depuis le téléphone) sont suivis côté serveur pour
// lire leur redirection ; seuls les domaines de Google sont appelés, jamais une adresse choisie par le visiteur.

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

// Liens courts de partage : maps.app.goo.gl (appli Maps), goo.gl/maps, share.google et g.co (bouton
// « Partager » de Google sur Android et iPhone).
const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "share.google", "g.co"];
// google.com, google.tg, google.co.uk, google.com.br… mais pas google.exemple.com.
const GOOGLE_HOST = /(^|\.)(google\.(com?\.)?[a-z]{2,3}|goo\.gl|share\.google|g\.co)$/;

// Le texte partagé contient souvent le nom du lieu puis le lien (« Pharmacie X https://share.google/… ») :
// on garde le premier lien.
export function extractLink(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[),.;!?]+$/, "") : null;
}

export function isShortMapsLink(text: string): boolean {
  const link = extractLink(text.trim());
  if (!link) return false;
  try {
    const u = new URL(link);
    return u.protocol === "https:" && SHORT_HOSTS.includes(u.hostname) && (u.hostname !== "goo.gl" || u.pathname.startsWith("/maps"));
  } catch {
    return false;
  }
}

// Coordonnées dans une page Google Maps : image d'aperçu (center=lat%2Clng), épingle !3d…!4d…, @lat,lng,
// ou l'état initial de la carte ([[[zoom,lng,lat]).
export function parseMapsPage(html: string): LatLng | null {
  const patterns: [RegExp, boolean][] = [
    [new RegExp(`!3d${NUM}!4d${NUM}`), false],
    [new RegExp(`[?&;]center=${NUM}(?:%2C|,)${NUM}`), false],
    [new RegExp(`[?&;](?:q|ll|markers)=${NUM}(?:%2C|,)${NUM}`), false],
    [new RegExp(`/@${NUM},${NUM},\\d`), false],
    [new RegExp(`APP_INITIALIZATION_STATE=\\[\\[\\[-?[\\d.]+,${NUM},${NUM}\\]`), true],
  ];
  for (const [re, lngFirst] of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const lat = Number(lngFirst ? m[2] : m[1]);
    const lng = Number(lngFirst ? m[1] : m[2]);
    if (valid(lat, lng)) return { latitude: lat, longitude: lng };
  }
  return null;
}

// Nom du lieu dans une adresse Google (/maps/place/Nom/… ou /search?q=Nom), pour le chercher sur la carte
// quand le lien ne donne pas de coordonnées.
export function placeNameFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!GOOGLE_HOST.test(u.hostname)) return null;
  const continued = u.searchParams.get("continue");
  if (u.hostname.startsWith("consent.") && continued) return placeNameFromUrl(continued);
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, " ")).trim();
    } catch {
      return s.trim();
    }
  };
  const place = u.pathname.match(/^\/maps\/(?:place|search)\/([^/@]+)/);
  let name = place ? decode(place[1]) : null;
  if (!name && (u.pathname === "/search" || u.pathname.startsWith("/maps"))) name = u.searchParams.get("q") ?? u.searchParams.get("query");
  name = name?.replace(/\s+/g, " ").trim() ?? null;
  if (!name || name.length < 3 || parseMapsLink(name)) return null;
  return name.slice(0, 200);
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export type MapsLinkResult = { point: LatLng | null; name: string | null };

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9",
  // Choix des cookies déjà fait (« tout refuser ») : sans lui, un serveur en Europe tombe sur consent.google.com
  // au lieu de la page de la carte.
  Cookie: "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmZyIAEaBgiA_LyaBg; CONSENT=PENDING+987",
};

// Identifiant Google du lieu (kgmid=/g/11x60mjf2c), donné par les liens share.google qui mènent à une recherche
// Google et non à la carte. Cherché aussi dans « continue » d'une page de consentement.
export function kgmidFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!GOOGLE_HOST.test(u.hostname)) return null;
  const id = u.searchParams.get("kgmid");
  if (id && /^\/[gm]\/[\w-]{3,40}$/.test(id)) return id;
  const continued = u.searchParams.get("continue");
  return continued ? kgmidFromUrl(continued) : null;
}

// Page Google Maps du lieu à partir de son identifiant : sa position est dans l'aperçu (center=lat%2Clng).
async function pointFromKgmid(id: string, fetcher: Fetcher): Promise<LatLng | null> {
  const url = "https://www.google.com/maps?" + new URLSearchParams({ kgmid: id, hl: "fr" });
  const res = await fetcher(url, { redirect: "follow", headers: HEADERS, signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  return parseMapsPage((await res.text()).slice(0, 2_000_000));
}

// Suit au plus 6 redirections, en restant sur les domaines de Google, et lit la position dans l'adresse finale
// ou, à défaut, dans la page elle-même. Si seul le nom du lieu est connu, il est rendu pour une recherche.
export async function followMapsLink(text: string, fetcher: Fetcher = fetch): Promise<MapsLinkResult> {
  const direct = parseMapsLink(text);
  if (direct) return { point: direct, name: null };
  const link = extractLink(text.trim());
  if (!link) return { point: null, name: null };
  const inLink = parseMapsLink(link);
  if (inLink) return { point: inLink, name: null };
  let start: URL;
  try {
    start = new URL(link);
  } catch {
    return { point: null, name: null };
  }
  if (start.protocol !== "https:" || !GOOGLE_HOST.test(start.hostname)) return { point: null, name: null };
  const startId = kgmidFromUrl(link);
  if (startId) return { point: await pointFromKgmid(startId, fetcher), name: placeNameFromUrl(link) };
  if (!isShortMapsLink(link)) return { point: null, name: placeNameFromUrl(link) };
  let url = fetchableUrl(start);
  if (!url) return { point: null, name: null };
  let name: string | null = null;
  for (let i = 0; i < 6; i++) {
    const res = await fetcher(url, { redirect: "manual", headers: HEADERS, signal: AbortSignal.timeout(5000) });
    let next = res.headers.get("location");
    if (!next) {
      if (!res.ok) return { point: null, name };
      const html = (await res.text()).slice(0, 2_000_000);
      const page = parseMapsPage(html);
      if (page) return { point: page, name: null };
      // Certaines pages de partage redirigent par une balise <meta http-equiv="refresh">.
      const refresh = html.match(/http-equiv=["']?refresh["']?[^>]*content=["']?\d*\s*;\s*url=([^"'>\s]+)/i);
      if (!refresh) return { point: null, name };
      next = refresh[1].replace(/&amp;/g, "&");
    }
    const target = new URL(next, url);
    const found = parseMapsLink(target.toString());
    if (found) return { point: found, name: null };
    if (!GOOGLE_HOST.test(target.hostname) || target.protocol !== "https:") return { point: null, name };
    name = placeNameFromUrl(target.toString()) ?? name;
    // share.google mène souvent à une recherche Google (…/search?q=Nom&kgmid=/g/…) : on ouvre la carte du lieu.
    const id = kgmidFromUrl(target.toString());
    if (id) {
      const point = await pointFromKgmid(id, fetcher);
      if (point) return { point, name: null };
      return { point: null, name };
    }
    // Page de consentement aux cookies : l'adresse voulue est dans « continue », inutile d'aller plus loin.
    if (target.hostname.startsWith("consent.")) return { point: null, name };
    url = fetchableUrl(target);
    if (!url) return { point: null, name };
  }
  return { point: null, name };
}

// Adresse réellement appelée : rebâtie à partir d'un hôte écrit en dur, jamais celui du texte collé, pour que le
// serveur ne puisse appeler que ces domaines de Google.
function fetchableUrl(u: URL): string | null {
  if (u.protocol !== "https:") return null;
  const rest = u.pathname.slice(1) + u.search;
  switch (u.hostname) {
    case "share.google":
      return "https://share.google/" + rest;
    case "maps.app.goo.gl":
      return "https://maps.app.goo.gl/" + rest;
    case "goo.gl":
      return "https://goo.gl/" + rest;
    case "g.co":
      return "https://g.co/" + rest;
    case "www.google.com":
      return "https://www.google.com/" + rest;
    case "google.com":
      return "https://google.com/" + rest;
    case "maps.google.com":
      return "https://maps.google.com/" + rest;
    case "www.google.tg":
      return "https://www.google.tg/" + rest;
    default:
      return null;
  }
}

export async function resolveMapsLink(text: string, fetcher: Fetcher = fetch): Promise<LatLng | null> {
  return (await followMapsLink(text, fetcher)).point;
}
