import express, { Router, type Request, type Response } from "express";
import type { FileStore } from "../storage.js";

// Photos des plats envoyées depuis le téléphone ou l'ordinateur (espace restaurant et admin).
// Le navigateur réduit la photo avant l'envoi (MenuEditor) ; elle arrive ici telle quelle, en binaire,
// est rangée dans R2 sous menu-images/<restaurant>/<nom aléatoire> et servie par /api/media/...
// Le lien renvoyé est complet (https://…) : il va dans imageUrl comme un lien collé à la main.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PREFIX = "menu-images/";

const TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": {
    ext: "webp",
    magic: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
};

// Lecture du corps binaire, seulement sur les routes d'envoi (le reste de l'API reste en JSON, 100 ko).
export const rawImage = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

// Range la photo du restaurant et renvoie son lien public.
export async function storeMenuImage(req: Request, res: Response, files: FileStore, restaurantId: string, origin: string) {
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const kind = TYPES[type];
  const body = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : null;
  if (!kind || !body || body.length < 12 || !kind.magic(body)) {
    res.status(400).json({ error: "Photo non reconnue : choisissez une image JPEG, PNG ou WebP" });
    return;
  }
  const base = `${origin.replace(/\/+$/, "")}/api/media/`;
  // Vignette (480 px, WebP ou JPEG) d'une photo déjà envoyée : ?thumbOf=<nom de la photo>. Les listes des cartes
  // l'affichent à la place de la photo entière (5 à 10 fois plus légère).
  const thumbOf = typeof req.query.thumbOf === "string" ? req.query.thumbOf : null;
  if (thumbOf !== null) {
    if (!THUMB_NAME.test(thumbOf) || (type !== "image/jpeg" && type !== "image/webp")) {
      res.status(400).json({ error: "Vignette non reconnue" });
      return;
    }
    await files.put(`${PREFIX}${restaurantId}/${THUMBS}${thumbOf}`, body, type);
    res.status(201).json({ url: `${base}${PREFIX}${restaurantId}/${thumbOf}?size=thumb` });
    return;
  }
  const key = `${PREFIX}${restaurantId}/${crypto.randomUUID()}.${kind.ext}`;
  await files.put(key, body, type);
  res.status(201).json({ url: `${base}${key}` });
}

const THUMBS = "thumbs/";
// Photos JPEG (envoyées avant) et WebP (navigateurs récents) ont leur vignette.
const THUMB_NAME = /^[0-9a-f-]{36}\.(jpg|webp)$/;

// Public : les photos des cartes, vues par les clients.
export function mediaRouter(config: { files: FileStore }) {
  const router = Router();
  router.get("/media/menu-images/:restaurant/:name", async (req, res) => {
    const { restaurant, name } = req.params;
    const ok = /^[A-Za-z0-9_-]{1,64}$/.test(restaurant) && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name);
    // ?size=thumb : la vignette si elle existe, sinon la photo entière (photos envoyées avant les vignettes).
    const thumb = ok && req.query.size === "thumb" && THUMB_NAME.test(name) ? await config.files.get(`${PREFIX}${restaurant}/${THUMBS}${name}`) : null;
    const file = thumb ?? (ok ? await config.files.get(`${PREFIX}${restaurant}/${name}`) : null);
    if (!file) {
      res.status(404).json({ error: "Photo introuvable" });
      return;
    }
    res.set("Content-Type", file.contentType);
    if (req.query.size === "thumb" && !thumb) {
      // Vignette pas encore faite : la photo entière, en cache une heure seulement, le temps que la carte soit ouverte
      // dans l'espace restaurant ou l'admin, qui fabrique alors la vignette (MenuEditor).
      res.set("X-Thumb", "missing");
      res.set("Cache-Control", "public, max-age=3600");
    } else {
      // Le nom est aléatoire et ne change jamais de contenu : la photo peut rester en cache longtemps.
      res.set("Cache-Control", "public, max-age=31536000, immutable");
    }
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(Buffer.from(file.body as ArrayBuffer));
  });

  // Vidéos publicitaires des boutiques. Les téléphones lisent une vidéo par morceaux (en-tête Range) : on renvoie
  // le morceau demandé (206), sinon la vidéo entière.
  router.get("/media/store-videos/:shop/:name", async (req, res) => {
    const { shop, name } = req.params;
    const ok = /^[A-Za-z0-9_-]{1,64}$/.test(shop) && /^[0-9a-f-]{36}\.(mp4|webm)$/.test(name);
    const file = ok ? await config.files.get(`${VIDEO_PREFIX}${shop}/${name}`) : null;
    if (!file) {
      res.status(404).json({ error: "Vidéo introuvable" });
      return;
    }
    const body = Buffer.from(file.body as ArrayBuffer);
    res.set("Content-Type", file.contentType);
    res.set("Accept-Ranges", "bytes");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    const range = byteRange(req.headers.range, body.length);
    if (range === "invalid") {
      res.status(416).set("Content-Range", `bytes */${body.length}`).end();
      return;
    }
    if (range) {
      res.status(206).set("Content-Range", `bytes ${range.start}-${range.end}/${body.length}`);
      res.send(body.subarray(range.start, range.end + 1));
      return;
    }
    res.send(body);
  });
  return router;
}

export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const VIDEO_PREFIX = "store-videos/";
const VIDEO_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  // MP4 : « ftyp » à partir du 5e octet.
  "video/mp4": { ext: "mp4", magic: (b) => String.fromCharCode(...b.slice(4, 8)) === "ftyp" },
  "video/webm": { ext: "webm", magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
};

export const rawVideo = express.raw({ type: () => true, limit: MAX_VIDEO_BYTES });

// Range la vidéo publicitaire d'une boutique (MP4 ou WebM, 20 Mo au plus) et renvoie son lien public.
export async function storeVideo(req: Request, res: Response, files: FileStore, folder: string, origin: string) {
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const kind = VIDEO_TYPES[type];
  const body = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : null;
  if (!kind || !body || body.length < 12 || !kind.magic(body)) {
    res.status(400).json({ error: "Vidéo non reconnue : choisissez une vidéo MP4 ou WebM de 20 Mo au plus" });
    return;
  }
  const key = `${VIDEO_PREFIX}${folder}/${crypto.randomUUID()}.${kind.ext}`;
  await files.put(key, body, type);
  res.status(201).json({ url: `${origin.replace(/\/+$/, "")}/api/media/${key}` });
}

// En-tête « Range: bytes=début-fin » (un seul morceau). null : pas de morceau demandé.
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // « bytes=-500 » : les 500 derniers octets.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}
