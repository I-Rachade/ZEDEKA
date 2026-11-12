import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { decodePhoto, photoInput, plateInput } from "../driverDocuments.js";
import { assignMotorbike, releaseMotorbike } from "../fleet.js";
import type { FileStore } from "../storage.js";
import { staffName } from "../team.js";
import { DOCUMENT_KINDS, type DocumentKind } from "../zed.js";
import { HttpError, write } from "./adminWrite.js";

// Admin : parc de motos de Zedeka (ajout, photo, retrait du service), attribution aux livreurs salariés et
// historique ; pièces des livreurs (photo de profil, pièce d'identité, permis, moto).

const bikeInput = z.object({
  plate: plateInput,
  label: z.string().trim().max(80).nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
  active: z.boolean().default(true),
});

const sendFile = (res: import("express").Response, file: { body: ArrayBuffer | Uint8Array; contentType: string }) => {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "private, no-store");
  res.end(Buffer.from(file.body instanceof Uint8Array ? file.body : new Uint8Array(file.body)));
};

export function adminFleetRouter(prisma: PrismaClient, config: { files?: FileStore }) {
  const router = Router();

  // Les motos, qui les a en ce moment, et les livreurs salariés à qui en donner une.
  router.get("/fleet", async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [bikes, staff, shifts] = await Promise.all([
      prisma.motorbike.findMany({
        orderBy: [{ active: "desc" }, { plate: "asc" }],
        select: { id: true, plate: true, label: true, note: true, active: true, photoKey: true, assignedAt: true, createdAt: true, driver: { select: { id: true, name: true, phone: true, online: true } } },
      }),
      prisma.driver.findMany({
        where: { employment: "STAFF", deletedAt: null, status: "APPROVED" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, online: true, active: true, vehicle: true, motorbike: { select: { id: true, plate: true } } },
      }),
      prisma.motorbikeShift.groupBy({ by: ["motorbikeId"], where: { startedAt: { gte: since } }, _count: { _all: true } }),
    ]);
    res.json({
      motorbikes: bikes.map(({ photoKey, ...b }) => ({ ...b, hasPhoto: !!photoKey, shifts30d: shifts.find((s) => s.motorbikeId === b.id)?._count._all ?? 0 })),
      drivers: staff,
    });
  });

  router.post(
    "/fleet",
    write(bikeInput, async (data) => prisma.motorbike.create({ data })),
  );

  router.patch(
    "/fleet/:id",
    write(
      bikeInput,
      async (data, id) => {
        const bike = await prisma.motorbike.findUnique({ where: { id }, select: { driverId: true } });
        if (!bike) throw new HttpError(404, "Moto introuvable");
        if (data.active === false && bike.driverId) throw new HttpError(409, "Cette moto est prise : reprenez-la au livreur avant de la retirer du service");
        const updated = await prisma.motorbike.update({ where: { id }, data });
        // Plaque corrigée pendant qu'un livreur l'a : le client voit la bonne.
        if (data.plate && bike.driverId) await prisma.driver.update({ where: { id: bike.driverId }, data: { plate: updated.plate } });
        return updated;
      },
      { partial: true },
    ),
  );

  // Supprimer une moto jamais utilisée (erreur de saisie) ; une moto avec un historique se retire du service.
  router.delete("/fleet/:id", async (req, res) => {
    const id = String(req.params.id);
    const bike = await prisma.motorbike.findUnique({ where: { id }, select: { driverId: true, photoKey: true, _count: { select: { shifts: true } } } });
    if (!bike) {
      res.status(404).json({ error: "Moto introuvable" });
      return;
    }
    if (bike.driverId || bike._count.shifts > 0) {
      res.status(409).json({ error: "Cette moto a déjà servi : retirez-la du service au lieu de la supprimer" });
      return;
    }
    if (bike.photoKey) await config.files?.delete(bike.photoKey).catch(() => {});
    await prisma.motorbike.delete({ where: { id } });
    res.json({ deleted: true });
  });

  router.post("/fleet/:id/assign", async (req, res) => {
    const parsed = z.object({ driverId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choisissez un livreur" });
      return;
    }
    try {
      await assignMotorbike(prisma, String(req.params.id), parsed.data.driverId, staffName(res) ?? "Direction");
      res.json({ ok: true });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res.status(e.status).json({ error: e.message });
    }
  });

  // Reprendre la moto au livreur (fin de service oubliée, panne).
  router.post("/fleet/:id/release", async (req, res) => {
    const bike = await prisma.motorbike.findUnique({ where: { id: String(req.params.id) }, select: { driverId: true } });
    if (!bike) {
      res.status(404).json({ error: "Moto introuvable" });
      return;
    }
    if (bike.driverId) await releaseMotorbike(prisma, bike.driverId);
    res.json({ ok: true });
  });

  router.get("/fleet/:id/history", async (req, res) => {
    const shifts = await prisma.motorbikeShift.findMany({
      where: { motorbikeId: String(req.params.id) },
      orderBy: { startedAt: "desc" },
      take: 50,
      select: { id: true, startedAt: true, endedAt: true, assignedBy: true, driver: { select: { name: true } } },
    });
    res.json(shifts);
  });

  router.put("/fleet/:id/photo", async (req, res) => {
    const parsed = z.object({ photo: photoInput }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Photo illisible" });
      return;
    }
    const id = String(req.params.id);
    const bike = await prisma.motorbike.findUnique({ where: { id }, select: { photoKey: true } });
    if (!bike) {
      res.status(404).json({ error: "Moto introuvable" });
      return;
    }
    if (!config.files) {
      res.status(503).json({ error: "L'envoi des photos n'est pas disponible pour le moment" });
      return;
    }
    try {
      const { bytes, contentType } = decodePhoto(parsed.data.photo);
      const key = `fleet/${id}-${Date.now()}`;
      await config.files.put(key, bytes, contentType);
      await prisma.motorbike.update({ where: { id }, data: { photoKey: key } });
      if (bike.photoKey) await config.files.delete(bike.photoKey).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res.status(e.status).json({ error: e.message });
    }
  });

  router.get("/fleet/:id/photo", async (req, res) => {
    const bike = await prisma.motorbike.findUnique({ where: { id: String(req.params.id) }, select: { photoKey: true } });
    const file = bike?.photoKey && config.files ? await config.files.get(bike.photoKey) : null;
    if (!file) {
      res.status(404).json({ error: "Photo introuvable" });
      return;
    }
    sendFile(res, file);
  });

  // Pièce d'un livreur (photo de profil, pièce d'identité, permis, moto) : comptes de l'admin seulement.
  router.get("/drivers/:id/documents/:kind", async (req, res) => {
    const kind = String(req.params.kind).toUpperCase() as DocumentKind;
    const doc = DOCUMENT_KINDS.includes(kind) ? await prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId: String(req.params.id), kind } } }) : null;
    const file = doc && config.files ? await config.files.get(doc.fileKey) : null;
    if (!file) {
      res.status(404).json({ error: "Photo introuvable" });
      return;
    }
    sendFile(res, file);
  });

  return router;
}
