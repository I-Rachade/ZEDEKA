import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { phone } from "../util.js";
import { HttpError, write } from "./adminWrite.js";
import { tripListWhere } from "./rentalPanel.js";
import { tripInclude, tripTotals } from "./rentalShared.js";

// Admin : loueurs de véhicules, leurs accès, leurs courses et leurs relevés.

const providerInput = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "minuscules, chiffres et tirets"),
  name: z.string().trim().min(2),
  phone,
  address: z.string().trim().min(2),
  commissionRate: z.number().int().min(0).max(50).default(10),
  active: z.boolean().default(true),
  pickupZoneId: z.string().min(1).nullable().default(null),
});

const accessInput = z.object({ email: z.string().trim().toLowerCase().email("e-mail invalide"), password: z.string().min(8, "au moins 8 caractères") });

export function adminRentalRouter(prisma: PrismaClient) {
  const router = Router();
  const omit = { ownerPasswordHash: true } as const;

  router.get("/rentals", async (_req, res) => {
    res.json(
      await prisma.rentalProvider.findMany({
        orderBy: { name: "asc" },
        omit,
        include: { pickupZone: { select: { name: true } }, _count: { select: { vehicles: true, trips: true, drivers: true } } },
      }),
    );
  });
  router.get("/rentals/:id", async (req, res) => {
    const p = await prisma.rentalProvider.findUnique({ where: { id: req.params.id }, omit, include: { pickupZone: { select: { name: true } } } });
    if (!p) {
      res.status(404).json({ error: "Loueur introuvable" });
      return;
    }
    const [trips, pending, settlements] = await Promise.all([
      prisma.trip.findMany({ where: { providerId: p.id }, orderBy: { createdAt: "desc" }, take: 50, include: tripInclude }),
      prisma.trip.findMany({ where: { providerId: p.id, status: "COMPLETED", settlementId: null }, select: { total: true, commission: true } }),
      prisma.rentalSettlement.findMany({ where: { providerId: p.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    res.json({ ...p, trips, pending: tripTotals(pending), settlements });
  });
  router.post("/rentals", write(providerInput, (data) => prisma.rentalProvider.create({ data, omit })));
  router.patch("/rentals/:id", write(providerInput, (data, id) => prisma.rentalProvider.update({ where: { id }, data, omit }), { partial: true }));
  router.put(
    "/rentals/:id/access",
    write(accessInput, async (data, id) => {
      const p = await prisma.rentalProvider.update({
        where: { id },
        data: { ownerEmail: data.email, ownerPasswordHash: await bcrypt.hash(data.password, 10), sessionsValidFrom: new Date() },
      });
      return { ownerEmail: p.ownerEmail };
    }),
  );

  router.get("/trips", async (req, res) => {
    res.json(await prisma.trip.findMany({ where: tripListWhere(req.query), orderBy: { createdAt: "desc" }, take: 200, include: tripInclude }));
  });

  // Relevé : toutes les courses terminées et pas encore réglées du loueur.
  router.post(
    "/rentals/:id/settlements",
    write(z.object({}), (_data, id) =>
      prisma.$transaction(async (tx) => {
        const trips = await tx.trip.findMany({ where: { providerId: id, status: "COMPLETED", settlementId: null } });
        if (trips.length === 0) throw new HttpError(400, "Aucune course terminée à régler");
        const dates = trips.map((t) => t.completedAt ?? t.createdAt);
        const settlement = await tx.rentalSettlement.create({
          data: {
            providerId: id,
            periodStart: new Date(Math.min(...dates.map(Number))),
            periodEnd: new Date(Math.max(...dates.map(Number))),
            ...tripTotals(trips),
          },
        });
        await tx.trip.updateMany({ where: { id: { in: trips.map((t) => t.id) } }, data: { settlementId: settlement.id } });
        return settlement;
      }),
    ),
  );
  router.patch(
    "/rental-settlements/:id",
    write(z.object({ paid: z.boolean() }), (data, id) =>
      prisma.rentalSettlement.update({ where: { id }, data: { paidAt: data.paid ? new Date() : null } }),
    ),
  );

  return router;
}
