import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { challengeLive, challengeProgress, extendPlus, extendSponsor, isSponsored, plusActive } from "../loyalty.js";
import type { Notifier } from "../notify.js";
import { formatFcfa } from "../pricing.js";
import { staffName } from "../team.js";
import { firstError, getSettings } from "../util.js";
import { HttpError, write } from "./adminWrite.js";

// Admin : Zedeka+ (demandes, abonnés, paiements), défis des livreurs et mises en avant payées des commerces.
// Les paiements sont encaissés à la main (mobile money ou espèces) puis saisis ici, comme les autres abonnements.

const customerSelect = { id: true, name: true, phone: true, plusUntil: true, plusRequestedAt: true } as const;

const plusPaymentInput = z.object({
  months: z.number().int().min(1).max(12),
  method: z.enum(["CASH", "FLOOZ", "TMONEY"]).default("CASH"),
  reference: z.string().trim().max(40).optional(),
  // Montant encaissé ; par défaut le prix du mois des réglages × le nombre de mois.
  amount: z.number().int().min(0).max(10_000_000).optional(),
});

const challengeInput = z.object({
  title: z.string().trim().min(3).max(80),
  target: z.number().int().min(1).max(10_000),
  reward: z.number().int().min(0).max(10_000_000),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  active: z.boolean().default(true),
});

const sponsorInput = z.object({
  weeks: z.number().int().min(1).max(52),
  amount: z.number().int().min(0).max(10_000_000).optional(),
});

export function adminLoyaltyRouter(prisma: PrismaClient, config: { notifier: Notifier }) {
  const router = Router();

  // --- Zedeka+ ---

  router.get("/plus", async (req, res) => {
    const now = new Date();
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const [settings, requests, members, payments, found] = await Promise.all([
      getSettings(prisma),
      prisma.customer.findMany({ where: { plusRequestedAt: { not: null }, deletedAt: null }, orderBy: { plusRequestedAt: "asc" }, take: 100, select: customerSelect }),
      prisma.customer.findMany({ where: { plusUntil: { gt: now }, deletedAt: null }, orderBy: { plusUntil: "asc" }, take: 500, select: customerSelect }),
      prisma.plusPayment.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { customer: { select: { name: true, phone: true } } } }),
      // Recherche d'un client (par téléphone ou nom) pour l'abonner au guichet ou au téléphone.
      q.length >= 3
        ? prisma.customer.findMany({ where: { deletedAt: null, OR: [{ phone: { contains: q.replace(/\s+/g, "") } }, { name: { contains: q } }] }, take: 10, select: customerSelect })
        : Promise.resolve([]),
    ]);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const month = await prisma.plusPayment.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { amount: true } });
    // Livraisons offertes ou réduites par Zedeka+ ce mois : ce que l'abonnement coûte à Zedeka.
    const given = await prisma.order.aggregate({ where: { plusApplied: true, status: { not: "CANCELLED" }, createdAt: { gte: monthStart } }, _sum: { discount: true }, _count: { _all: true } });
    res.json({
      settings: { plusEnabled: settings.plusEnabled, plusMonthlyFee: settings.plusMonthlyFee, plusDeliveryDiscount: settings.plusDeliveryDiscount, plusMinSubtotal: settings.plusMinSubtotal },
      requests,
      members,
      found: found.map((c) => ({ ...c, active: plusActive(c.plusUntil, now) })),
      payments,
      stats: { members: members.length, cashedThisMonth: month._sum.amount ?? 0, ordersThisMonth: given._count._all, discountThisMonth: given._sum.discount ?? 0 },
    });
  });

  router.post("/plus/:customerId/payments", async (req, res) => {
    const parsed = plusPaymentInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const customer = await prisma.customer.findUnique({ where: { id: req.params.customerId }, select: { id: true, plusUntil: true, deletedAt: true } });
    if (!customer || customer.deletedAt) {
      res.status(404).json({ error: "Client introuvable" });
      return;
    }
    const settings = await getSettings(prisma);
    const { months, method, reference } = parsed.data;
    const amount = parsed.data.amount ?? settings.plusMonthlyFee * months;
    const { startsAt, endsAt } = extendPlus(customer.plusUntil, months);
    await prisma.plusPayment.create({ data: { customerId: customer.id, amount, months, method, reference: reference || null, startsAt, endsAt, createdBy: staffName(res) ?? "Direction" } });
    const updated = await prisma.customer.update({ where: { id: customer.id }, data: { plusUntil: endsAt, plusRequestedAt: null }, select: customerSelect });
    void config.notifier
      .push("customer", customer.id, {
        title: "Zedeka+ activé",
        body: `Vos livraisons de repas sont avantagées jusqu'au ${endsAt.toLocaleDateString("fr-FR", { timeZone: "Africa/Lome" })}.`,
        url: "/app/fidelite",
        tag: `plus-${customer.id}`,
      })
      .catch(() => 0);
    res.status(201).json(updated);
  });

  // Arrêt (remboursement fait à part si besoin) : l'abonnement prend fin tout de suite.
  router.post("/plus/:customerId/stop", async (req, res) => {
    const found = await prisma.customer.findUnique({ where: { id: req.params.customerId }, select: { id: true } });
    if (!found) {
      res.status(404).json({ error: "Client introuvable" });
      return;
    }
    res.json(await prisma.customer.update({ where: { id: found.id }, data: { plusUntil: new Date() }, select: customerSelect }));
  });

  router.delete("/plus/:customerId/request", async (req, res) => {
    const found = await prisma.customer.findUnique({ where: { id: req.params.customerId }, select: { id: true } });
    if (!found) {
      res.status(404).json({ error: "Client introuvable" });
      return;
    }
    await prisma.customer.update({ where: { id: found.id }, data: { plusRequestedAt: null } });
    res.status(204).end();
  });

  // --- Défis des livreurs ---

  router.get("/challenges", async (_req, res) => {
    const now = new Date();
    const challenges = await prisma.driverChallenge.findMany({ orderBy: { startsAt: "desc" }, take: 50, include: { _count: { select: { rewards: true } } } });
    res.json(
      await Promise.all(
        challenges.map(async ({ _count, ...c }) => {
          const progress = await challengeProgress(prisma, c);
          const reached = [...progress.values()].filter((n) => n >= c.target).length;
          return { ...c, live: challengeLive(c, now), ended: c.endsAt <= now, reached, paid: _count.rewards };
        }),
      ),
    );
  });

  router.get("/challenges/:id", async (req, res) => {
    const c = await prisma.driverChallenge.findUnique({ where: { id: req.params.id }, include: { rewards: true } });
    if (!c) {
      res.status(404).json({ error: "Défi introuvable" });
      return;
    }
    const progress = await challengeProgress(prisma, c);
    const drivers = progress.size ? await prisma.driver.findMany({ where: { id: { in: [...progress.keys()] } }, select: { id: true, name: true, phone: true } }) : [];
    const paidOf = new Map(c.rewards.map((r) => [r.driverId, r]));
    const board = drivers
      .map((d) => ({ ...d, done: progress.get(d.id) ?? 0, reached: (progress.get(d.id) ?? 0) >= c.target, paidAt: paidOf.get(d.id)?.paidAt ?? null, paidBy: paidOf.get(d.id)?.paidBy ?? null }))
      .sort((a, b) => b.done - a.done);
    const { rewards: _r, ...challenge } = c;
    res.json({ ...challenge, live: challengeLive(c), board });
  });

  const checkPeriod = (startsAt: Date, endsAt: Date) => {
    if (startsAt >= endsAt) throw new HttpError(400, "La date de fin doit suivre la date de début");
  };

  router.post(
    "/challenges",
    write(challengeInput, async (data) => {
      checkPeriod(data.startsAt, data.endsAt);
      return prisma.driverChallenge.create({ data });
    }),
  );

  router.patch(
    "/challenges/:id",
    write(
      challengeInput,
      async (data, id) => {
        const current = await prisma.driverChallenge.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "Défi introuvable");
        checkPeriod(data.startsAt ?? current.startsAt, data.endsAt ?? current.endsAt);
        return prisma.driverChallenge.update({ where: { id }, data });
      },
      { partial: true },
    ),
  );

  router.delete("/challenges/:id", async (req, res) => {
    const c = await prisma.driverChallenge.findUnique({ where: { id: req.params.id }, include: { _count: { select: { rewards: true } } } });
    if (!c) {
      res.status(404).json({ error: "Défi introuvable" });
      return;
    }
    // Une prime déjà versée garde sa trace : le défi est seulement masqué.
    if (c._count.rewards > 0) await prisma.driverChallenge.update({ where: { id: c.id }, data: { active: false } });
    else await prisma.driverChallenge.delete({ where: { id: c.id } });
    res.status(204).end();
  });

  // Prime versée à un livreur qui a atteint l'objectif (une seule fois par défi).
  router.post("/challenges/:id/rewards", async (req, res) => {
    const parsed = z.object({ driverId: z.string().min(1) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Livreur manquant" });
      return;
    }
    const c = await prisma.driverChallenge.findUnique({ where: { id: req.params.id } });
    if (!c) {
      res.status(404).json({ error: "Défi introuvable" });
      return;
    }
    const done = (await challengeProgress(prisma, c, parsed.data.driverId)).get(parsed.data.driverId) ?? 0;
    if (done < c.target) {
      res.status(409).json({ error: `Objectif pas encore atteint : ${done} livraison(s) sur ${c.target}` });
      return;
    }
    const existing = await prisma.driverChallengeReward.findUnique({ where: { challengeId_driverId: { challengeId: c.id, driverId: parsed.data.driverId } } });
    if (existing) {
      res.status(409).json({ error: "Prime déjà versée" });
      return;
    }
    const reward = await prisma.driverChallengeReward.create({ data: { challengeId: c.id, driverId: parsed.data.driverId, amount: c.reward, paidBy: staffName(res) ?? "Direction" } });
    void config.notifier
      .push("driver", parsed.data.driverId, { title: "Prime de défi versée", body: `${c.title} : ${formatFcfa(c.reward)}`, url: "/livreur/defis", tag: `challenge-${c.id}` })
      .catch(() => 0);
    res.status(201).json(reward);
  });

  // --- Mises en avant payées des commerces ---

  router.get("/sponsors", async (_req, res) => {
    const now = new Date();
    const [settings, commerces, payments] = await Promise.all([
      getSettings(prisma),
      prisma.restaurant.findMany({
        where: { deletedAt: null, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true, kind: true, logoUrl: true, sponsoredUntil: true },
      }),
      prisma.sponsorPayment.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { restaurant: { select: { name: true } } } }),
    ]);
    res.json({
      weekFee: settings.sponsorWeekFee,
      commerces: commerces.map((c) => ({ ...c, sponsored: isSponsored(c.sponsoredUntil, now) })),
      payments,
    });
  });

  router.post("/sponsors/:restaurantId", async (req, res) => {
    const parsed = sponsorInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const r = await prisma.restaurant.findFirst({ where: { id: req.params.restaurantId, deletedAt: null }, select: { id: true, sponsoredUntil: true } });
    if (!r) {
      res.status(404).json({ error: "Commerce introuvable" });
      return;
    }
    const settings = await getSettings(prisma);
    const { weeks } = parsed.data;
    const amount = parsed.data.amount ?? settings.sponsorWeekFee * weeks;
    const { startsAt, endsAt } = extendSponsor(r.sponsoredUntil, weeks);
    await prisma.sponsorPayment.create({ data: { restaurantId: r.id, amount, weeks, startsAt, endsAt, createdBy: staffName(res) ?? "Direction" } });
    res.status(201).json(await prisma.restaurant.update({ where: { id: r.id }, data: { sponsoredUntil: endsAt }, select: { id: true, name: true, sponsoredUntil: true } }));
  });

  router.post("/sponsors/:restaurantId/stop", async (req, res) => {
    const r = await prisma.restaurant.findFirst({ where: { id: req.params.restaurantId }, select: { id: true } });
    if (!r) {
      res.status(404).json({ error: "Commerce introuvable" });
      return;
    }
    res.json(await prisma.restaurant.update({ where: { id: r.id }, data: { sponsoredUntil: null }, select: { id: true, name: true, sponsoredUntil: true } }));
  });

  return router;
}
