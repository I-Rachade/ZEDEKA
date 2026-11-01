import { Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HttpError, write } from "./adminWrite.js";
import { getSettings } from "../util.js";
import { vendorPlan } from "./vendorApplications.js";
import type { FileStore } from "../storage.js";

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

// Envoie un fichier téléversé ; seules les clés des candidatures sont servies.
export async function sendUpload(res: Response, files: FileStore, key: string | null) {
  const file = key && key.startsWith("vendor-applications/") && !key.includes("..") ? await files.get(key) : null;
  if (!file) {
    res.status(404).json({ error: "Fichier introuvable" });
    return;
  }
  res.set("Content-Type", file.contentType);
  res.set("X-Content-Type-Options", "nosniff");
  res.send(Buffer.from(file.body as ArrayBuffer));
}

export function adminVendorsRouter(prisma: PrismaClient, config: { files: FileStore }) {
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
    const fee = a.monthlyFee ?? (await getSettings(prisma)).vendorSubscriptionFee;
    res.json({ ...a, planDetails: vendorPlan(fee) });
  });

  router.get("/vendor-applications/:id/files/:kind", async (req, res) => {
    const field = FILES[req.params.kind as keyof typeof FILES];
    const a = field ? await prisma.vendorApplication.findUnique({ where: { id: req.params.id } }) : null;
    await sendUpload(res, config.files, a ? a[field] : null);
  });

  router.post(
    "/vendor-applications/:id/approve",
    write(z.object({ commissionRate: z.number().int().min(0).max(50).optional() }), async (data, id) => {
      const a = await prisma.vendorApplication.findUnique({ where: { id } });
      if (!a) throw new HttpError(404, "Candidature introuvable");
      if (a.status !== "PENDING") throw new HttpError(409, "Cette candidature a déjà été traitée");
      if (await prisma.restaurant.findUnique({ where: { ownerEmail: a.email } })) {
        throw new HttpError(409, "Un restaurant utilise déjà cet e-mail");
      }
      const base = slugify(a.businessName);
      let slug = base;
      for (let n = 2; await prisma.restaurant.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;
      // Les candidatures d'avant l'abonnement unique n'ont pas de prix : on prend le prix actuel.
      const subscriptionFee = a.monthlyFee ?? (await getSettings(prisma)).vendorSubscriptionFee;

      // Sans transaction (D1) : on réserve d'abord la candidature, pour qu'un double clic ne crée pas deux restaurants.
      const claimed = await prisma.vendorApplication.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", reviewedAt: new Date() } });
      if (claimed.count === 0) throw new HttpError(409, "Cette candidature a déjà été traitée");
      try {
        const restaurant = await prisma.restaurant.create({
          data: {
            slug,
            name: a.businessName,
            phone: a.phone,
            address: a.address,
            latitude: a.latitude,
            longitude: a.longitude,
            // Sans position, le restaurant reste masqué : l'admin la place ou la demande au gérant depuis sa fiche.
            active: a.latitude != null && a.longitude != null,
            zoneId: a.zoneId,
            deliveryTimeMin: a.deliveryTimeMin,
            deliveryTimeMax: a.deliveryTimeMax,
            commissionRate: data.commissionRate ?? 0,
            subscriptionFee,
            // même domaine que le site
            logoUrl: `/api/partner-logos/${a.reference}`,
            ownerEmail: a.email,
            // le gérant se connecte avec le mot de passe choisi à l'inscription
            ownerPasswordHash: a.passwordHash,
          },
          omit: { ownerPasswordHash: true, sessionsValidFrom: true },
        });
        await prisma.vendorApplication.update({ where: { id }, data: { restaurantId: restaurant.id } });
        return restaurant;
      } catch (e) {
        await prisma.vendorApplication.update({ where: { id }, data: { status: "PENDING", reviewedAt: null } });
        throw e;
      }
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
export function partnerLogoRouter(prisma: PrismaClient, config: { files: FileStore }) {
  const router = Router();
  router.get("/partner-logos/:reference", async (req, res) => {
    const a = await prisma.vendorApplication.findUnique({ where: { reference: req.params.reference } });
    res.set("Cache-Control", "public, max-age=86400");
    await sendUpload(res, config.files, a?.status === "APPROVED" ? a.logoPath : null);
  });
  return router;
}
