import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HttpError, write } from "./adminWrite.js";
import { claimInto } from "./adminFinance.js";
import { balanceOf, daysOf } from "./merchantApp.js";
import { staffName } from "../team.js";

// Admin : boutiques e-commerce (appli marchand) et reversements du contre-remboursement.
// Lecture et suspension avec les commerces ; les reversements sont des finances (directeur seul en écriture).

const unpaidWhere = (merchantId?: string) => ({ ...(merchantId ? { merchantId } : { merchantId: { not: null } }), status: "DELIVERED" as const, merchantPayoutId: null });
const moneySelect = { merchantId: true, cashCollected: true, total: true, deliveryFee: true, extraFee: true, discount: true, codAmount: true } as const;

export function adminMerchantsRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/merchants", async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [merchants, unpaid, recent, open] = await Promise.all([
      prisma.merchant.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          shopName: true,
          phone: true,
          pickupAddress: true,
          pickupLatitude: true,
          pickupLongitude: true,
          pickupDays: true,
          pickupTime: true,
          payoutPhone: true,
          active: true,
          pickupRequestedAt: true,
          createdAt: true,
          customer: { select: { name: true, email: true } },
        },
      }),
      prisma.order.findMany({ where: unpaidWhere(), select: moneySelect }),
      prisma.order.groupBy({ by: ["merchantId"], where: { merchantId: { not: null }, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.order.groupBy({ by: ["merchantId"], where: { merchantId: { not: null }, status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP"] } }, _count: { _all: true } }),
    ]);
    res.json(
      merchants.map((m) => {
        const mine = unpaid.filter((o) => o.merchantId === m.id);
        return {
          ...m,
          pickupDays: daysOf(m.pickupDays),
          owner: m.customer.name,
          email: m.customer.email,
          customer: undefined,
          sent30d: recent.find((r) => r.merchantId === m.id)?._count._all ?? 0,
          open: open.find((r) => r.merchantId === m.id)?._count._all ?? 0,
          balance: balanceOf(mine),
          balanceCount: mine.length,
        };
      }),
    );
  });

  // Suspendre ou réactiver une boutique (plus d'envois tant qu'elle est suspendue).
  router.patch(
    "/merchants/:id",
    write(z.object({ active: z.boolean() }), (data, id) => prisma.merchant.update({ where: { id }, data: { active: data.active }, select: { id: true, active: true } })),
  );

  // Détail des colis livrés à reverser à une boutique.
  router.get("/finance/merchant-payouts/:merchantId/pending", async (req, res) => {
    const orders = await prisma.order.findMany({
      where: unpaidWhere(req.params.merchantId),
      orderBy: { deliveredAt: "asc" },
      select: { ...moneySelect, code: true, recipientName: true, merchantRef: true, payer: true, deliveredAt: true },
    });
    res.json({ orders, balance: balanceOf(orders) });
  });

  // Reversement : rattache les colis livrés pas encore reversés, puis calcule le montant sur ce qui a été rattaché.
  router.post(
    "/finance/merchant-payouts",
    write(z.object({ merchantId: z.string().min(1), note: z.string().trim().max(200).optional() }), async (data, _id, res) => {
      const merchant = await prisma.merchant.findUnique({ where: { id: data.merchantId }, select: { id: true } });
      if (!merchant) throw new HttpError(404, "Boutique introuvable");
      return claimInto(
        () => prisma.order.findMany({ where: unpaidWhere(data.merchantId), select: { id: true } }),
        "Aucun colis livré à reverser pour cette boutique",
        () => prisma.merchantPayout.create({ data: { merchantId: data.merchantId, amount: 0, note: data.note, paidBy: staffName(res) } }),
        (ids, payoutId) => prisma.order.updateMany({ where: { id: { in: ids }, merchantPayoutId: null }, data: { merchantPayoutId: payoutId } }),
        async (payoutId) => {
          const claimed = await prisma.order.findMany({ where: { merchantPayoutId: payoutId }, select: moneySelect });
          return prisma.merchantPayout.update({ where: { id: payoutId }, data: { amount: balanceOf(claimed), orderCount: claimed.length } });
        },
        (payoutId) => prisma.merchantPayout.delete({ where: { id: payoutId } }),
      );
    }),
  );

  router.get("/finance/merchant-payouts", async (_req, res) => {
    res.json(
      await prisma.merchantPayout.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, amount: true, orderCount: true, note: true, paidBy: true, createdAt: true, merchant: { select: { id: true, shopName: true } } },
      }),
    );
  });

  return router;
}
