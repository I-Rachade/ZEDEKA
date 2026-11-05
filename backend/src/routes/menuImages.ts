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
  // Vignette (480 px, JPEG) d'une photo déjà envoyée : ?thumbOf=<nom de la photo>. Les listes des cartes
  // l'affichent à la place de la photo entière (5 à 10 fois plus légère).
  const thumbOf = typeof req.query.thumbOf === "string" ? req.query.thumbOf : null;
  if (thumbOf !== null) {
    if (!THUMB_NAME.test(thumbOf) || type !== "image/jpeg") {
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
const THUMB_NAME = /^[0-9a-f-]{36}\.jpg$/;

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
  return router;
}
