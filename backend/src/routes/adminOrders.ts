import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { OPEN, STATUSES, statusUpdate } from "../orderFlow.js";
import { lineLabel } from "../pricing.js";
import { HttpError, write } from "./adminWrite.js";

const orderPatch = z.object({
  status: z.enum(STATUSES),
  driverId: z.string().nullable(),
  paymentStatus: z.enum(["UNPAID", "PAID"]),
  discount: z.number().int().min(0).max(1_000_000),
  extraFee: z.number().int().min(0).max(1_000_000),
  cancellationReason: z.string().trim().min(3).max(300),
});

export const listInclude = {
  restaurant: { select: { name: true, phone: true } },
  zone: { select: { name: true } },
  driver: { select: { id: true, name: true, phone: true } },
  parcelCategory: { select: { name: true } },
  items: { select: { name: true, variantName: true, addons: true, quantity: true, unitPrice: true } },
} satisfies Prisma.OrderInclude;

// Filtres de la liste : statut, type, mode de remise, période, recherche par code ou téléphone.
export function listWhere(q: Record<string, unknown>): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  const status = STATUSES.find((s) => s === q.status);
  if (status) where.status = status;
  if (q.type === "FOOD" || q.type === "PARCEL") where.type = q.type;
  if (q.fulfillment === "DELIVERY" || q.fulfillment === "PICKUP") where.fulfillment = q.fulfillment;
  const from = typeof q.from === "string" && q.from ? new Date(`${q.from}T00:00:00Z`) : null;
  const to = typeof q.to === "string" && q.to ? new Date(`${q.to}T23:59:59.999Z`) : null;
  if ((from && !isNaN(+from)) || (to && !isNaN(+to))) {
    where.createdAt = { ...(from && !isNaN(+from) && { gte: from }), ...(to && !isNaN(+to) && { lte: to }) };
  }
  const search = typeof q.q === "string" ? q.q.trim() : "";
  if (search) {
    where.OR = [
      { code: { contains: search.toUpperCase() } },
      { customerPhone: { contains: search } },
      { customerName: { contains: search, mode: "insensitive" } },
    ];
  }
  return where;
}

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function adminOrdersRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/orders", async (req, res) => {
    const where = listWhere(req.query);
    if (req.query.format === "csv") {
      const orders = await prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, include: listInclude });
      const header = [
        "Code", "Date", "Type", "Mode", "Statut", "Restaurant", "Zone", "Client", "Téléphone", "Adresse",
        "Articles", "Sous-total", "Remise", "Livraison", "Supplément", "Total", "Paiement", "Payé", "Livreur",
        "Commission Zedeka", "Part livreur",
      ];
      const rows = orders.map((o) => [
        o.code,
        o.createdAt.toISOString(),
        o.type === "FOOD" ? "Repas" : "Colis",
        o.fulfillment === "PICKUP" ? "À emporter" : "Livraison",
        o.status,
        o.restaurant?.name ?? "",
        o.zone.name,
        o.customerName,
        o.customerPhone,
        o.address,
        o.items.map((i) => `${i.quantity} x ${lineLabel({ ...i, addons: i.addons as { name: string }[] })}`).join(" | "),
        o.subtotal,
        o.discount,
        o.deliveryFee,
        o.extraFee,
        o.total,
        o.paymentMethod === "CASH" ? "Espèces" : "Mobile money",
        o.paymentStatus === "PAID" ? "oui" : "non",
        o.driver?.name ?? "",
        o.commission,
        o.driverEarning,
      ]);
      const csv = [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="commandes-zedeka.csv"`);
      res.send(`﻿${csv}`); // BOM pour qu'Excel lise les accents
      return;
    }
    res.json(await prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: listInclude }));
  });

  router.get("/orders/counts", async (req, res) => {
    const { status: _ignored, ...rest } = req.query;
    const groups = await prisma.order.groupBy({ by: ["status"], _count: { _all: true }, where: listWhere(rest) });
    const counts = Object.fromEntries(STATUSES.map((s) => [s, groups.find((g) => g.status === s)?._count._all ?? 0]));
    res.json({ ...counts, ALL: groups.reduce((sum, g) => sum + g._count._all, 0) });
  });

  router.get("/orders/:id", async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { ...listInclude, restaurant: { select: { name: true, phone: true, address: true } }, cashCollection: true, settlement: true },
    });
    if (!order) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    res.json(order);
  });

  router.patch(
    "/orders/:id",
    write(
      orderPatch,
      async (data, id) => {
        const current = await prisma.order.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "Commande introuvable");
        const closed = current.status === "DELIVERED" || current.status === "CANCELLED";
        if (closed && data.status && data.status !== current.status) {
          throw new HttpError(409, "Cette commande est déjà clôturée");
        }

        const update: Prisma.OrderUncheckedUpdateInput = {};
        if (data.driverId !== undefined) {
          if (data.driverId) {
            const driver = await prisma.driver.findUnique({ where: { id: data.driverId } });
            if (!driver || !driver.active || driver.status !== "APPROVED") throw new HttpError(400, "Livreur indisponible");
          }
          update.driverId = data.driverId;
        }
        if (data.paymentStatus) update.paymentStatus = data.paymentStatus;

        const discount = data.discount ?? current.discount;
        const extraFee = data.extraFee ?? current.extraFee;
        if (data.discount !== undefined || data.extraFee !== undefined) {
          if (closed) throw new HttpError(409, "Montants non modifiables sur une commande clôturée");
          const total = current.subtotal - discount + current.deliveryFee + extraFee;
          if (total < 0) throw new HttpError(400, "La remise dépasse le montant de la commande");
          Object.assign(update, { discount, extraFee, total });
        }

        if (data.status && data.status !== current.status) {
          Object.assign(
            update,
            await statusUpdate(prisma, current, data.status, { reason: data.cancellationReason, extraFee }),
          );
        }

        return prisma.order.update({ where: { id }, data: update, include: listInclude });
      },
      { partial: true },
    ),
  );

  // Répartition : commandes à affecter, en cours, et livreurs disponibles.
  router.get("/dispatch", async (_req, res) => {
    const [unassigned, ongoing, drivers] = await Promise.all([
      prisma.order.findMany({
        // Repas : visibles une fois prêts au restaurant. Colis : dès la demande.
        where: {
          status: { in: OPEN },
          driverId: null,
          fulfillment: "DELIVERY",
          OR: [{ type: "PARCEL" }, { status: { in: ["READY", "PICKED_UP"] } }],
        },
        orderBy: { createdAt: "asc" },
        include: listInclude,
      }),
      prisma.order.findMany({
        where: { status: { in: OPEN }, driverId: { not: null }, fulfillment: "DELIVERY" },
        orderBy: { createdAt: "asc" },
        include: listInclude,
      }),
      prisma.driver.findMany({
        where: { active: true, status: "APPROVED" },
        orderBy: [{ online: "desc" }, { name: "asc" }],
        include: { zone: { select: { name: true } }, _count: { select: { orders: { where: { status: { in: OPEN } } } } } },
      }),
    ]);
    res.json({
      unassigned,
      ongoing,
      drivers: drivers.map(({ _count, ...d }) => ({ ...d, activeOrders: _count.orders })),
    });
  });

  return router;
}
