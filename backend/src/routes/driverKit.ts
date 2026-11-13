import type { Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { idStatus } from "../idExpiry.js";
import { missingDocuments, photoInput, plateInput, storeDocuments } from "../driverDocuments.js";
import { motorbikeSelect, needsMotorbike } from "../fleet.js";
import type { Notifier } from "../notify.js";
import type { FileStore } from "../storage.js";
import { firstError } from "../util.js";
import { DOCUMENT_KINDS, type DocumentKind } from "../zed.js";
import { HttpError } from "./adminWrite.js";

// Application livreur : ses pièces (photo de profil, pièce d'identité, permis, photo de la moto), sa plaque
// (livreur indépendant) et les motos du parc (salarié). Monté sur /api/livreur, après la connexion.

type KitConfig = { notifier: Notifier; files?: FileStore };

const kindParam = (raw: unknown): DocumentKind => {
  const kind = String(raw).toUpperCase() as DocumentKind;
  if (!DOCUMENT_KINDS.includes(kind)) throw new HttpError(404, "Pièce inconnue");
  return kind;
};

function send(res: Response, e: unknown) {
  if (e instanceof HttpError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  throw e;
}

// Pièces, plaque et moto d'un livreur, pour son profil.
export async function driverKit(prisma: PrismaClient, driverId: string) {
  const [driver, docs, bike] = await Promise.all([
    prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { plate: true, employment: true, vehicle: true, online: true } }),
    prisma.zedDocument.findMany({ where: { driverId }, select: { kind: true, createdAt: true, issuedAt: true, expiresAt: true } }),
    prisma.motorbike.findUnique({ where: { driverId }, select: { ...motorbikeSelect, assignedAt: true } }),
  ]);
  const staff = driver.employment === "STAFF";
  return {
    documents: docs.map((d) => ({
      kind: d.kind,
      updatedAt: d.createdAt,
      ...(d.kind === "ID_CARD" ? { issuedAt: d.issuedAt, expiresAt: d.expiresAt, status: idStatus(d.expiresAt) } : {}),
    })),
    missing: missingDocuments(docs),
    // Indépendant : sa propre plaque, qu'il change lui-même. Salarié : celle de la moto du parc qu'il a prise.
    plate: driver.plate,
    canEditPlate: !staff,
    motorbike: bike ? { id: bike.id, plate: bike.plate, label: bike.label, hasPhoto: !!bike.photoKey, assignedAt: bike.assignedAt } : null,
    needsMotorbike: !bike && (await needsMotorbike(prisma, driver)),
  };
}

export function driverKitRoutes(router: Router, prisma: PrismaClient, config: KitConfig) {
  const { notifier } = config;

  router.get("/kit", async (_req, res) => {
    res.json(await driverKit(prisma, res.locals.driverId));
  });

  // Photo de la moto du livreur indépendant : la seule photo qu'il change lui-même (l'équipe est prévenue).
  // Photo de profil, pièce d'identité et permis : seule l'équipe (admin ou adjoint) les dépose, dans l'admin.
  router.put("/documents/:kind", async (req, res) => {
    try {
      const kind = kindParam(req.params.kind);
      if (kind !== "MOTO") throw new HttpError(403, "Votre photo et vos pièces sont ajoutées par l'équipe Zedeka");
      const driverId: string = res.locals.driverId;
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { name: true, employment: true } });
      // Salarié : la photo de la moto est celle du parc, prise dans l'admin.
      if (driver.employment === "STAFF") throw new HttpError(403, "La moto vient du parc Zedeka : sa photo est gérée par l'équipe");
      const parsed = z.object({ photo: photoInput }).safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, firstError(parsed.error));
      const had = await prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId, kind } }, select: { id: true } });
      await storeDocuments(prisma, config.files, driverId, { MOTO: parsed.data.photo });
      await notifier.staff("DRIVERS", {
        title: had ? "Photo de moto changée" : "Photo de moto ajoutée",
        body: `${driver.name} a ${had ? "changé" : "ajouté"} la photo de sa moto.`,
        url: "/admin/livreurs",
        tag: `driver-doc-${driverId}-${kind}`,
      });
      res.json(await driverKit(prisma, driverId));
    } catch (e) {
      send(res, e);
    }
  });

  // Le livreur revoit sa propre photo (aperçu dans son profil).
  router.get("/documents/:kind", async (req, res) => {
    try {
      const kind = kindParam(req.params.kind);
      const doc = await prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId: res.locals.driverId, kind } } });
      const file = doc && config.files ? await config.files.get(doc.fileKey) : null;
      if (!file) throw new HttpError(404, "Photo introuvable");
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Cache-Control", "private, no-store");
      res.end(Buffer.from(file.body instanceof Uint8Array ? file.body : new Uint8Array(file.body)));
    } catch (e) {
      send(res, e);
    }
  });

  // Plaque du livreur indépendant : il la change lui-même (nouvelle moto), l'équipe est prévenue.
  router.patch("/plate", async (req, res) => {
    try {
      const parsed = z.object({ plate: plateInput }).safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, firstError(parsed.error));
      const driverId: string = res.locals.driverId;
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { name: true, employment: true, plate: true } });
      if (driver.employment === "STAFF") throw new HttpError(403, "Votre plaque est celle de la moto du parc que vous prenez");
      if (driver.plate !== parsed.data.plate) {
        await prisma.driver.update({ where: { id: driverId }, data: { plate: parsed.data.plate } });
        await notifier.staff("DRIVERS", {
          title: "Plaque de livreur changée",
          body: `${driver.name} : ${driver.plate ? `${driver.plate} → ` : ""}${parsed.data.plate}`,
          url: "/admin/livreurs",
          tag: `driver-plate-${driverId}`,
        });
      }
      res.json(await driverKit(prisma, driverId));
    } catch (e) {
      send(res, e);
    }
  });

  // Motos libres du parc, pour le salarié qui commence son service.
  router.get("/motorbikes", async (_req, res) => {
    const free = await prisma.motorbike.findMany({ where: { active: true, driverId: null }, orderBy: { plate: "asc" }, select: motorbikeSelect });
    res.json(free.map(({ photoKey, ...b }) => ({ ...b, hasPhoto: !!photoKey })));
  });

  // Photo d'une moto du parc (liste de choix et profil du salarié).
  router.get("/motorbikes/:id/photo", async (req, res) => {
    const bike = await prisma.motorbike.findUnique({ where: { id: String(req.params.id) }, select: { photoKey: true } });
    const file = bike?.photoKey && config.files ? await config.files.get(bike.photoKey) : null;
    if (!file) {
      res.status(404).json({ error: "Photo introuvable" });
      return;
    }
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(Buffer.from(file.body instanceof Uint8Array ? file.body : new Uint8Array(file.body)));
  });
}
