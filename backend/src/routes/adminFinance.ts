import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HttpError, write } from "./adminWrite.js";

const settlementInput = z.object({
  restaurantId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const period = (from: string, to: string) => ({ gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59.999Z`) });

// Ce que Zedeka doit au restaurant : les plats vendus, moins sa commission.
// Remises et frais de livraison restent à la charge ou au profit de Zedeka.
export function settlementTotals(orders: { subtotal: number; commission: number }[]) {
  const orderTotal = orders.reduce((s, o) => s + o.subtotal, 0);
  const commission = orders.reduce((s, o) => s + o.commission, 0);
  return { orderCount: orders.length, orderTotal, commission, amountDue: orderTotal - commission };
}

export function adminFinanceRouter(prisma: PrismaClient) {
  const router = Router();

  // Espèces encaissées par chaque livreur et pas encore remises à Zedeka.
  router.get("/finance/cash", async (_req, res) => {
    const [drivers, orders, history] = await Promise.all([
      prisma.driver.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } }),
      prisma.order.findMany({
        where: { status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null, driverId: { not: null } },
        select: { id: true, code: true, total: true, cashCollected: true, cashNote: true, driverEarning: true, deliveredAt: true, driverId: true },
        orderBy: { deliveredAt: "asc" },
      }),
      prisma.cashCollection.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { driver: { select: { name: true } }, _count: { select: { orders: true } } },
      }),
    ]);
    res.json({
      drivers: drivers.map((d) => {
        const mine = orders.filter((o) => o.driverId === d.id);
        return {
          ...d,
          orders: mine,
          // Montant déclaré reçu par le livreur (avec motif en cas d'écart), sinon le total.
          cashHeld: mine.reduce((s, o) => s + (o.cashCollected ?? o.total), 0),
          earnings: mine.reduce((s, o) => s + o.driverEarning, 0),
        };
      }),
      history,
    });
  });

  router.post(
    "/finance/cash",
    write(z.object({ driverId: z.string().min(1), note: z.string().trim().max(200).optional() }), (data) =>
      prisma.$transaction(async (tx) => {
        const orders = await tx.order.findMany({
          where: { driverId: data.driverId, status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null },
          select: { id: true, total: true, cashCollected: true },
        });
        if (orders.length === 0) throw new HttpError(400, "Aucune somme à encaisser pour ce livreur");
        const collection = await tx.cashCollection.create({
          data: { driverId: data.driverId, amount: orders.reduce((s, o) => s + (o.cashCollected ?? o.total), 0), note: data.note },
        });
        // Seules les commandes encore non remises : deux clics simultanés ne comptent pas deux fois la même somme.
        const { count } = await tx.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) }, cashCollectionId: null },
          data: { cashCollectionId: collection.id, paymentStatus: "PAID" },
        });
        if (count !== orders.length) throw new HttpError(409, "Remise déjà enregistrée, rechargez la page");
        return collection;
      }),
    ),
  );

  // Aperçu des reversements : commandes repas livrées et non réglées, par restaurant.
  router.get("/finance/settlements/preview", async (req, res) => {
    const parsed = settlementInput.omit({ restaurantId: true }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Période invalide" });
      return;
    }
    const orders = await prisma.order.findMany({
      where: {
        type: "FOOD",
        status: "DELIVERED",
        settlementId: null,
        restaurantId: { not: null },
        deliveredAt: period(parsed.data.from, parsed.data.to),
      },
      select: { restaurantId: true, subtotal: true, commission: true },
    });
    const restaurants = await prisma.restaurant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    res.json(
      restaurants
        .map((r) => ({ ...r, ...settlementTotals(orders.filter((o) => o.restaurantId === r.id)) }))
        .filter((r) => r.orderCount > 0),
    );
  });

  router.get("/finance/settlements", async (_req, res) => {
    res.json(
      await prisma.restaurantSettlement.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { restaurant: { select: { name: true } } },
      }),
    );
  });

  router.post(
    "/finance/settlements",
    write(settlementInput, (data) =>
      prisma.$transaction(async (tx) => {
        const orders = await tx.order.findMany({
          where: {
            restaurantId: data.restaurantId,
            type: "FOOD",
            status: "DELIVERED",
            settlementId: null,
            deliveredAt: period(data.from, data.to),
          },
          select: { id: true, subtotal: true, commission: true },
        });
        if (orders.length === 0) throw new HttpError(400, "Aucune commande à régler sur cette période");
        const settlement = await tx.restaurantSettlement.create({
          data: {
            restaurantId: data.restaurantId,
            periodStart: new Date(`${data.from}T00:00:00Z`),
            periodEnd: new Date(`${data.to}T23:59:59.999Z`),
            ...settlementTotals(orders),
          },
        });
        const { count } = await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) }, settlementId: null }, data: { settlementId: settlement.id } });
        if (count !== orders.length) throw new HttpError(409, "Reversement déjà enregistré, rechargez la page");
        return settlement;
      }),
    ),
  );

  router.patch(
    "/finance/settlements/:id",
    write(
      z.object({ paid: z.boolean() }),
      (data, id) => prisma.restaurantSettlement.update({ where: { id }, data: { paidAt: data.paid ? new Date() : null } }),
      { partial: true },
    ),
  );

  return router;
}
