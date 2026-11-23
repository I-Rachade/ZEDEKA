import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { loyaltySummary, plusState } from "../loyalty.js";
import type { Notifier } from "../notify.js";
import { formatFcfa } from "../pricing.js";
import { getSettings } from "../util.js";

// Appli client : « Fidélité et Zedeka+ ». Solde de points, état de l'abonnement, et demande d'abonnement (l'équipe
// rappelle le client pour le paiement, puis active Zedeka+ dans l'admin).
export function customerLoyaltyRoutes(router: Router, prisma: PrismaClient, notifier: Notifier) {
  router.get("/loyalty", async (_req, res) => {
    const id: string = res.locals.customerId;
    const [settings, me] = await Promise.all([getSettings(prisma), prisma.customer.findUniqueOrThrow({ where: { id }, select: { plusUntil: true, plusRequestedAt: true } })]);
    const [points, history] = await Promise.all([
      loyaltySummary(prisma, id, settings),
      prisma.order.findMany({
        where: { customerId: id, OR: [{ plusApplied: true }, { loyaltyRedeemed: { gt: 0 } }], status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { code: true, createdAt: true, discount: true, plusApplied: true, loyaltyRedeemed: true },
      }),
    ]);
    res.json({ points, plus: plusState(me, settings), history });
  });

  // Demande d'abonnement : une seule en attente ; l'équipe est prévenue (finances).
  router.post("/plus/request", async (_req, res) => {
    const id: string = res.locals.customerId;
    const settings = await getSettings(prisma);
    if (!settings.plusEnabled) {
      res.status(409).json({ error: "Zedeka+ n'est pas proposé pour le moment" });
      return;
    }
    const me = await prisma.customer.findUniqueOrThrow({ where: { id }, select: { name: true, phone: true, plusUntil: true, plusRequestedAt: true } });
    if (!me.plusRequestedAt) {
      await prisma.customer.update({ where: { id }, data: { plusRequestedAt: new Date() } });
      await notifier
        .staff("FINANCE", {
          title: "Demande Zedeka+",
          body: `${me.name ?? "Client"} (${me.phone}) veut s'abonner : ${formatFcfa(settings.plusMonthlyFee)} par mois`,
          url: "/admin/zedeka-plus",
          tag: `plus-${id}`,
        })
        .catch(() => {});
    }
    const after = await prisma.customer.findUniqueOrThrow({ where: { id }, select: { plusUntil: true, plusRequestedAt: true } });
    res.json(plusState(after, settings));
  });

  router.delete("/plus/request", async (_req, res) => {
    const id: string = res.locals.customerId;
    const [settings, me] = await Promise.all([
      getSettings(prisma),
      prisma.customer.update({ where: { id }, data: { plusRequestedAt: null }, select: { plusUntil: true, plusRequestedAt: true } }),
    ]);
    res.json(plusState(me, settings));
  });
}
