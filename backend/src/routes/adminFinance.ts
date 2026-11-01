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

// Relevé (espèces ou reversement) sans transaction : le relevé est créé vide, les commandes encore libres lui sont
// rattachées par une mise à jour conditionnelle, puis ses totaux sont calculés sur les commandes rattachées.
// Deux clics en même temps donnent au plus un relevé avec des commandes ; l'autre est supprimé.
export async function claimInto<T extends { id: string }>(
  pending: () => Promise<{ id: string }[]>,
  emptyMessage: string,
  create: () => Promise<T>,
  attach: (ids: string[], recordId: string) => Promise<{ count: number }>,
  finish: (recordId: string) => Promise<T>,
  remove: (recordId: string) => Promise<unknown>,
): Promise<T> {
  const ids = (await pending()).map((o) => o.id);
  if (ids.length === 0) throw new HttpError(400, emptyMessage);
  const record = await create();
  const { count } = await attach(ids, record.id);
  if (count === 0) {
    await remove(record.id);
    throw new HttpError(409, emptyMessage);
  }
  return finish(record.id);
}

export function adminFinanceRouter(prisma: PrismaClient) {
  const router = Router();

  // Espèces encaissées par chaque livreur et pas encore remises à Zedeka.
  router.get("/finance/cash", async (_req, res) => {
    const [drivers, orders, history] = await Promise.all([
      prisma.driver.findMany({ where: { status: "APPROVED", deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } }),
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
      // D1 n'a pas de transactions : on crée le relevé, on y rattache les commandes encore libres (une commande
      // ne peut être prise que par un seul relevé), puis on calcule le montant sur ce qui a vraiment été rattaché.
      claimInto(
        () =>
          prisma.order.findMany({
            where: { driverId: data.driverId, status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null },
            select: { id: true },
          }),
        "Aucune somme à encaisser pour ce livreur",
        () => prisma.cashCollection.create({ data: { driverId: data.driverId, amount: 0, note: data.note } }),
        (ids, collectionId) =>
          prisma.order.updateMany({ where: { id: { in: ids }, cashCollectionId: null }, data: { cashCollectionId: collectionId, paymentStatus: "PAID" } }),
        async (collectionId) => {
          const claimed = await prisma.order.findMany({ where: { cashCollectionId: collectionId }, select: { total: true, cashCollected: true } });
          return prisma.cashCollection.update({ where: { id: collectionId }, data: { amount: claimed.reduce((s, o) => s + (o.cashCollected ?? o.total), 0) } });
        },
        (collectionId) => prisma.cashCollection.delete({ where: { id: collectionId } }),
      ),
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
      claimInto(
        () =>
          prisma.order.findMany({
            where: { restaurantId: data.restaurantId, type: "FOOD", status: "DELIVERED", settlementId: null, deliveredAt: period(data.from, data.to) },
            select: { id: true },
          }),
        "Aucune commande à régler sur cette période",
        () =>
          prisma.restaurantSettlement.create({
            data: {
              restaurantId: data.restaurantId,
              periodStart: new Date(`${data.from}T00:00:00Z`),
              periodEnd: new Date(`${data.to}T23:59:59.999Z`),
              ...settlementTotals([]),
            },
          }),
        (ids, settlementId) => prisma.order.updateMany({ where: { id: { in: ids }, settlementId: null }, data: { settlementId } }),
        async (settlementId) => {
          const claimed = await prisma.order.findMany({ where: { settlementId }, select: { subtotal: true, commission: true } });
          return prisma.restaurantSettlement.update({ where: { id: settlementId }, data: settlementTotals(claimed) });
        },
        (settlementId) => prisma.restaurantSettlement.delete({ where: { id: settlementId } }),
      ),
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
