import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FileStore } from "../storage.js";
import { webUrl } from "../util.js";
import { rawImage, storeMenuImage } from "./menuImages.js";
import { HttpError, write } from "./adminWrite.js";

// Publicités de l'accueil de l'appli client : un carrousel de bannières sous « Livrer à ».
// L'admin ajoute l'image (envoyée depuis l'appareil ou par lien), un lien facultatif, l'ordre, et peut
// la masquer ou limiter sa période d'affichage. Les clients ne voient que les publicités actives du moment.

// Les images sont rangées avec les photos des plats (R2, menu-images/ads/...), servies par /api/media.
const AD_FOLDER = "ads";
export const MAX_ADS_SHOWN = 10;

// Lien au toucher : une page de l'appli ou du site (/app/recherche, /colis…) ou un lien https:// externe.
const link = z.union([z.string().trim().regex(/^\/(?!\/)[^\s]{0,300}$/, "lien invalide"), webUrl]).nullable();
const date = z.coerce.date().nullable();

const adInput = z.object({
    title: z.string().trim().min(2).max(80),
    imageUrl: webUrl,
    linkUrl: link.default(null),
    position: z.number().int().min(0).max(999).default(0),
    active: z.boolean().default(true),
    startsAt: date.default(null),
    endsAt: date.default(null),
});

function checkPeriod(startsAt: Date | null, endsAt: Date | null) {
  if (startsAt && endsAt && startsAt >= endsAt) throw new HttpError(400, "La date de fin doit suivre la date de début");
}

// Affichée maintenant : active et dans sa période (dates facultatives).
export const liveAdsWhere = (now: Date) => ({
  active: true,
  AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
});

export function publicAdsRouter(prisma: PrismaClient) {
  const router = Router();
  router.get("/ads", async (_req, res) => {
    const ads = await prisma.ad.findMany({
      where: liveAdsWhere(new Date()),
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      take: MAX_ADS_SHOWN,
      select: { id: true, title: true, imageUrl: true, linkUrl: true },
    });
    // Court cache : une publicité ajoutée ou retirée apparaît en une minute au plus.
    res.set("Cache-Control", "public, max-age=60");
    res.json(ads);
  });
  return router;
}

export function adminAdsRouter(prisma: PrismaClient, config: { files?: FileStore; frontendOrigin: string }) {
  const router = Router();

  router.get("/ads", async (_req, res) => {
    res.json(await prisma.ad.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }));
  });

  router.post("/ads/images", rawImage, async (req, res) => {
    if (!config.files) {
      res.status(503).json({ error: "Envoi de photos indisponible" });
      return;
    }
    await storeMenuImage(req, res, config.files, AD_FOLDER, config.frontendOrigin);
  });

  router.post(
    "/ads",
    write(adInput, async (data) => {
      checkPeriod(data.startsAt, data.endsAt);
      return prisma.ad.create({ data });
    }),
  );

  router.patch(
    "/ads/:id",
    write(
      adInput,
      async (data, id) => {
        const current = await prisma.ad.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "Publicité introuvable");
        checkPeriod(data.startsAt === undefined ? current.startsAt : data.startsAt, data.endsAt === undefined ? current.endsAt : data.endsAt);
        return prisma.ad.update({ where: { id }, data });
      },
      { partial: true },
    ),
  );

  router.delete("/ads/:id", async (req, res) => {
    const ad = await prisma.ad.findUnique({ where: { id: req.params.id } });
    if (!ad) {
      res.status(404).json({ error: "Publicité introuvable" });
      return;
    }
    await prisma.ad.delete({ where: { id: ad.id } });
    // L'image envoyée depuis l'appareil n'est plus utile : on la retire du stockage (un lien externe reste tel quel).
    const key = ad.imageUrl.match(/\/api\/media\/(menu-images\/ads\/[0-9a-f-]{36}\.(?:jpg|png|webp))$/)?.[1];
    if (key && config.files) await config.files.delete(key).catch(() => {});
    res.status(204).end();
  });

  return router;
}
