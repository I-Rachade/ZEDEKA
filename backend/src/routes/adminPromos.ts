import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { normalizeCode, PROMO_KINDS, promoLabel } from "../promo.js";
import { firstError } from "../util.js";

const DAY = 86_400_000;

const promoInput = z
  .object({
    code: z.string().trim().min(3, "Code trop court").max(20).transform(normalizeCode).refine((c) => /^[A-Z0-9_-]+$/.test(c), "Lettres et chiffres seulement"),
    title: z.string().trim().max(60).nullish(),
    kind: z.enum(PROMO_KINDS),
    value: z.number().int().min(0).max(1_000_000).default(0),
    maxDiscount: z.number().int().min(0).max(1_000_000).nullish(),
    minSubtotal: z.number().int().min(0).max(10_000_000).default(0),
    restaurantId: z.string().nullish(),
    payer: z.enum(["ZEDEKA", "RESTAURANT"]).default("ZEDEKA"),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    maxUses: z.number().int().min(1).max(1_000_000).nullish(),
    perCustomer: z.number().int().min(0).max(100).default(1),
    showOnHome: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((p) => p.kind !== "PERCENT" || (p.value >= 1 && p.value <= 100), { message: "Pourcentage entre 1 et 100", path: ["value"] })
  .refine((p) => p.kind !== "AMOUNT" || p.value >= 1, { message: "Indiquez le montant de la remise", path: ["value"] })
  .refine((p) => p.payer !== "RESTAURANT" || !!p.restaurantId, { message: "Une remise payée par le restaurant vise ce restaurant seulement", path: ["restaurantId"] })
  .refine((p) => !p.startsAt || !p.endsAt || p.startsAt < p.endsAt, { message: "La fin doit suivre le début", path: ["endsAt"] });

// Page Promotions du back-office : codes, offre, où, qui paie, période, utilisations et coût. Écriture : directeur.
export function adminPromosRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/promos", async (_req, res) => {
    const since = new Date(Date.now() - 30 * DAY);
    const live = { status: { not: "CANCELLED" } } as const;
    const [promos, allTime, recent, foodOrders] = await Promise.all([
      prisma.promo.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }], include: { restaurant: { select: { id: true, name: true } } } }),
      prisma.order.groupBy({ by: ["promoId"], where: { promoId: { not: null }, ...live }, _count: { _all: true }, _sum: { discount: true } }),
      prisma.order.groupBy({ by: ["promoId", "promoPayer"], where: { promoId: { not: null }, createdAt: { gte: since }, ...live }, _count: { _all: true }, _sum: { discount: true } }),
      prisma.order.count({ where: { type: "FOOD", createdAt: { gte: since }, ...live } }),
    ]);
    const total = new Map(allTime.map((g) => [g.promoId, { uses: g._count._all, cost: g._sum.discount ?? 0 }]));
    const uses30 = recent.reduce((s, g) => s + g._count._all, 0);
    const now = new Date();
    res.json({
      summary: {
        active: promos.filter((p) => p.active && (!p.endsAt || p.endsAt > now)).length,
        uses30,
        zedekaCost30: recent.filter((g) => g.promoPayer !== "RESTAURANT").reduce((s, g) => s + (g._sum.discount ?? 0), 0),
        share30: foodOrders ? Math.round((uses30 / foodOrders) * 100) : 0,
      },
      promos: promos.map((p) => ({ ...p, label: promoLabel(p), uses: total.get(p.id)?.uses ?? 0, cost: total.get(p.id)?.cost ?? 0 })),
    });
  });

  router.post("/promos", async (req, res) => {
    const parsed = promoInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    if (await prisma.promo.findUnique({ where: { code: parsed.data.code }, select: { id: true } })) {
      res.status(409).json({ error: "Ce code existe déjà" });
      return;
    }
    res.status(201).json(await prisma.promo.create({ data: parsed.data }));
  });

  // Activer, masquer de l'accueil ou corriger une promotion (le code ne change pas : il est déjà sur des commandes).
  router.patch("/promos/:id", async (req, res) => {
    const parsed = z
      .object({ active: z.boolean(), showOnHome: z.boolean(), title: z.string().trim().max(60).nullable(), endsAt: z.coerce.date().nullable(), maxUses: z.number().int().min(1).nullable() })
      .partial()
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const found = await prisma.promo.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!found) {
      res.status(404).json({ error: "Promotion introuvable" });
      return;
    }
    res.json(await prisma.promo.update({ where: { id: found.id }, data: parsed.data }));
  });

  return router;
}
