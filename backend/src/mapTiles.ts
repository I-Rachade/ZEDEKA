// Fond de carte Zedeka : la carte du Togo (fichier PMTiles de Protomaps, tiré d'OpenStreetMap). Le workflow « Carte du
// Togo » (.github/workflows/carte.yml) la découpe chaque mois et la publie dans la release GitHub « carte-togo » ;
// syncMap la recopie dans R2 sous MAP_KEY quand elle change. L'API en sert les tuiles une à une
// (/api/carte/{z}/{x}/{y}.mvt) ; le site les dessine avec protomaps-leaflet et les garde en cache au point de présence.

import { Compression, EtagMismatch, PMTiles, type RangeResponse, type Source } from "pmtiles";

export const MAP_KEY = "cartes/togo.pmtiles";
export const MAP_SOURCE_URL = "https://github.com/I-Rachade/ZEDEKA/releases/download/carte-togo/togo.pmtiles";

// Lecture par plages d'octets dans R2. Le fichier est remplacé chaque mois : si son etag change entre deux lectures,
// pmtiles relit l'en-tête (EtagMismatch) au lieu de mélanger deux versions.
export class R2Source implements Source {
  constructor(
    private bucket: R2Bucket,
    private key: string,
  ) {}

  getKey() {
    return this.key;
  }

  async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length }, onlyIf: etag ? { etagMatches: etag } : undefined });
    if (!obj) throw new Error("carte absente");
    if (!("body" in obj)) throw new EtagMismatch();
    return { data: await obj.arrayBuffer(), etag: obj.etag };
  }
}

const TILE = /^\/api\/carte\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.mvt$/;

export const isMapPath = (pathname: string) => pathname === "/api/carte/info" || TILE.test(pathname);

let current: { bucket: R2Bucket; tiles: PMTiles } | null = null;
function open(bucket: R2Bucket) {
  if (current?.bucket !== bucket) current = { bucket, tiles: new PMTiles(new R2Source(bucket, MAP_KEY)) };
  return current.tiles;
}

const json = (body: unknown, maxAge: number) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` } });

async function gunzip(data: ArrayBuffer) {
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

export async function serveMap(request: Request, bucket: R2Bucket): Promise<Response> {
  const { pathname } = new URL(request.url);
  const tiles = open(bucket);

  if (pathname === "/api/carte/info") {
    // Le site choisit son fond : notre carte si elle est en place, OpenStreetMap sinon.
    try {
      const h = await tiles.getHeader();
      return json({ available: true, minZoom: h.minZoom, maxZoom: h.maxZoom, bounds: [h.minLat, h.minLon, h.maxLat, h.maxLon] }, 300);
    } catch {
      current = null;
      return json({ available: false }, 60);
    }
  }

  const m = pathname.match(TILE);
  if (!m) return new Response("Introuvable", { status: 404 });
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (z > 22 || x >= 2 ** z || y >= 2 ** z) return new Response("Introuvable", { status: 404 });
  try {
    const h = await tiles.getHeader();
    const tile = z <= h.maxZoom ? await tiles.getZxy(z, x, y) : undefined;
    // Hors du Togo ou au-delà du zoom le plus fin : tuile vide (le site agrandit celle du niveau 15).
    if (!tile) return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=86400" } });
    const data = h.tileCompression === Compression.Gzip ? await gunzip(tile.data) : tile.data;
    return new Response(data, { headers: { "Content-Type": "application/x-protobuf", "Cache-Control": "public, max-age=86400" } });
  } catch (e) {
    current = null;
    console.error("carte", e);
    return new Response("Carte indisponible", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

// Recopie la carte publiée dans R2 si elle a changé (comparaison de l'etag de la release). Appelée une fois par heure.
export async function syncMap(bucket: R2Bucket, source = MAP_SOURCE_URL, fetcher: typeof fetch = fetch): Promise<"à jour" | "copiée" | "absente"> {
  const head = await fetcher(source, { method: "HEAD", redirect: "follow" });
  if (!head.ok) return "absente";
  const version = head.headers.get("etag") ?? head.headers.get("last-modified") ?? "";
  const size = Number(head.headers.get("content-length"));
  if (!version || !(size > 0)) return "absente";
  const stored = await bucket.head(MAP_KEY);
  if (stored?.customMetadata?.source === version) return "à jour";

  const res = await fetcher(source, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`carte : téléchargement ${res.status}`);
  // R2 veut connaître la taille d'un flux : FixedLengthStream la donne sans garder les ~100 Mo en mémoire.
  const { readable, writable } = new FixedLengthStream(size);
  const copy = res.body.pipeTo(writable);
  await Promise.all([
    bucket.put(MAP_KEY, readable, { httpMetadata: { contentType: "application/vnd.pmtiles" }, customMetadata: { source: version } }),
    copy,
  ]);
  current = null;
  return "copiée";
}
