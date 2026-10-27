import path from "node:path";
import { Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HttpError, write } from "./adminWrite.js";
import { VENDOR_PLANS } from "./vendorApplications.js";

// Admin : examen des candidatures partenaires. La validation crée le restaurant avec l'accès du gérant.

const FILES = { logo: "logoPath", cover: "coverPath", legalDoc: "legalDocPath" } as const;

export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "partenaire"
  );
}

// Envoie un fichier du dossier des téléversements sans jamais sortir de ce dossier.
export function sendUpload(res: Response, uploadDir: string, relative: string | null) {
  const root = path.resolve(uploadDir);
  const file = relative ? path.resolve(root, relative) : "";
  if (!relative || !file.startsWith(root + path.sep)) {
    res.status(404).json({ error: "Fichier introuvable" });
    return;
  }
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "Fichier introuvable" });
  });
}

export function adminVendorsRouter(prisma: PrismaClient, config: { uploadDir: string }) {
  const router = Router();
  const omit = { passwordHash: true } as const;

  router.get("/vendor-applications", async (req, res) => {
    const status = ["PENDING", "APPROVED", "REJECTED"].find((s) => s === req.query.status) as "PENDING" | undefined;
    const [rows, groups] = await Promise.all([
      prisma.vendorApplication.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
        omit,
        include: { zone: { select: { name: true } } },
      }),
      prisma.vendorApplication.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(["PENDING", "APPROVED", "REJECTED"].map((s) => [s, groups.find((g) => g.status === s)?._count._all ?? 0]));
    res.json({ applications: rows, counts });
  });

  router.get("/vendor-applications/:id", async (req, res) => {
    const a = await prisma.vendorApplication.findUnique({
      where: { id: req.params.id },
      omit,
      include: { zone: { select: { name: true } }, restaurant: { select: { id: true, slug: true, name: true } } },
    });
    if (!a) {
      res.status(404).json({ error: "Candidature introuvable" });
      return;
    }
    res.json({ ...a, planDetails: VENDOR_PLANS.find((p) => p.id === a.plan) ?? null });
  });

  router.get("/vendor-applications/:id/files/:kind", async (req, res) => {
    const field = FILES[req.params.kind as keyof typeof FILES];
    const a = field ? await prisma.vendorApplication.findUnique({ where: { id: req.params.id } }) : null;
    sendUpload(res, config.uploadDir, a ? a[field] : null);
  });

  router.post(
    "/vendor-applications/:id/approve",
    write(z.object({ commissionRate: z.number().int().min(0).max(50).optional() }), async (data, id, res) => {
      const a = await prisma.vendorApplication.findUnique({ where: { id } });
      if (!a) throw new HttpError(404, "Candidature introuvable");
      if (a.status !== "PENDING") throw new HttpError(409, "Cette candidature a déjà été traitée");
      if (await prisma.restaurant.findUnique({ where: { ownerEmail: a.email } })) {
        throw new HttpError(409, "Un restaurant utilise déjà cet e-mail");
      }
      const base = slugify(a.businessName);
      let slug = base;
      for (let n = 2; await prisma.restaurant.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;
      const plan = VENDOR_PLANS.find((p) => p.id === a.plan);
      const origin = `${res.req.protocol}://${res.req.get("host")}`;

      return prisma.$transaction(async (tx) => {
        const restaurant = await tx.restaurant.create({
          data: {
            slug,
            name: a.businessName,
            phone: a.phone,
            address: a.address,
            latitude: a.latitude,
            longitude: a.longitude,
            zoneId: a.zoneId,
            deliveryTimeMin: a.deliveryTimeMin,
            deliveryTimeMax: a.deliveryTimeMax,
            commissionRate: data.commissionRate ?? plan?.commissionPercent ?? 10,
            logoUrl: `${origin}/api/partner-logos/${a.reference}`,
            ownerEmail: a.email,
            // le gérant se connecte avec le mot de passe choisi à l'inscription
            ownerPasswordHash: a.passwordHash,
          },
          omit: { ownerPasswordHash: true, sessionsValidFrom: true },
        });
        await tx.vendorApplication.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date(), restaurantId: restaurant.id } });
        return restaurant;
      });
    }),
  );

  router.post(
    "/vendor-applications/:id/reject",
    write(z.object({ reason: z.string().trim().min(3).max(300) }), async (data, id) => {
      const a = await prisma.vendorApplication.findUnique({ where: { id } });
      if (!a) throw new HttpError(404, "Candidature introuvable");
      if (a.status !== "PENDING") throw new HttpError(409, "Cette candidature a déjà été traitée");
      return prisma.vendorApplication.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date(), rejectionReason: data.reason }, omit });
    }),
  );

  return router;
}

// Public : logo d'un partenaire validé, affiché sur sa page.
export function partnerLogoRouter(prisma: PrismaClient, config: { uploadDir: string }) {
  const router = Router();
  router.get("/partner-logos/:reference", async (req, res) => {
    const a = await prisma.vendorApplication.findUnique({ where: { reference: req.params.reference } });
    res.set("Cache-Control", "public, max-age=86400");
    sendUpload(res, config.uploadDir, a?.status === "APPROVED" ? a.logoPath : null);
  });
  return router;
}
