import { AWAITING, awaitingPosition } from "../locationRequest.js";
import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { PARCEL_ZONE_ID } from "../delivery.js";
import { OPEN, STATUSES, statusUpdate } from "../orderFlow.js";
import { lineLabel } from "../pricing.js";
import { orderTotal } from "../parcel.js";
import { HttpError, write } from "./adminWrite.js";
import type { Notifier } from "../notify.js";
import { assignDriver } from "./driverApp.js";
import { ISSUE_KINDS } from "../driver.js";
import { isDirector, MANAGER_LOCKED_ORDER_FIELDS, staffName, staffRole } from "../team.js";
import { AUTO_DISPATCH_NAME } from "../autoDispatch.js";
import { withoutPin } from "../pin.js";
import { notifyCustomer } from "../customerNotify.js";
import { alertLowDeposit } from "../deposit.js";

const orderPatch = z.object({
  status: z.enum(STATUSES),
  driverId: z.string().nullable(),
  paymentStatus: z.enum(["UNPAID", "PAID"]),
  discount: z.number().int().min(0).max(1_000_000),
  extraFee: z.number().int().min(0).max(1_000_000),
  // Colis : zone à attribuer (adresse écrite sans position) et prix à confirmer.
  zoneId: z.string().min(1),
  deliveryFee: z.number().int().min(0).max(1_000_000),
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
      { customerName: { contains: search } },
    ];
  }
  return where;
}

const assignmentSelect = { status: true, reason: true, assignedBy: true, createdAt: true, respondedAt: true, driver: { select: { name: true, employment: true } } } satisfies Prisma.DriverAssignmentSelect;

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const ORDERS_PAGE = 50;
const CSV_MAX_ROWS = 5000;

export function adminOrdersRouter(prisma: PrismaClient, notifier: Notifier) {
  const router = Router();

  router.get("/orders", async (req, res) => {
    const where = listWhere(req.query);
    if (req.query.format === "csv") {
      // Export plafonné : au-delà, choisir une période plus courte (dates « du » et « au »).
      const orders = await prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, take: CSV_MAX_ROWS, include: listInclude });
      const header = [
        "Code", "Date", "Type", "Mode", "Statut", "Restaurant", "Zone", "Client", "Téléphone", "Adresse",
        "Articles", "Sous-total", "Remise", "Livraison", "Supplément", "Total", "Paiement", "Payé", "Livreur",
        "Commission Zedeka", "Part livreur",
      ];
      const rows = orders.map((o) => [
        o.code,
        o.createdAt.toISOString(),
        o.type === "FOOD" ? "Repas" : "Colis",
        o.tableNumber !== null ? `Sur place, table ${o.tableNumber}` : o.fulfillment === "PICKUP" ? "À emporter" : "Livraison",
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
    // Par pages de 50, les plus récentes d'abord ; « before » (date de la dernière ligne reçue) donne la page suivante.
    const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
    const page = before && !isNaN(+before) ? { ...where, AND: [{ createdAt: { lt: before } }] } : where;
    res.json(await prisma.order.findMany({ where: page, orderBy: { createdAt: "desc" }, take: ORDERS_PAGE, include: listInclude }));
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
      include: {
        ...listInclude,
        restaurant: { select: { name: true, phone: true, address: true } },
        cashCollection: true,
        settlement: true,
        locationRequest: { select: { status: true, expiresAt: true, accuracyM: true, respondedAt: true } },
      },
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
      async (data, id, res) => {
        const current = await prisma.order.findUnique({ where: { id }, include: { locationRequest: { select: { status: true } } } });
        if (!current) throw new HttpError(404, "Commande introuvable");
        // Managerin et administrateur adjoint annulent et accordent des remises, mais les frais de livraison
        // restent au directeur (le dispatcheur non plus n'y touche pas).
        if (!isDirector(res) && MANAGER_LOCKED_ORDER_FIELDS.some((f) => data[f] !== undefined)) {
          throw new HttpError(403, "Frais de livraison : réservé au directeur");
        }
        // Colis dont le destinataire n'a pas encore donné sa position : ni livreur ni avancement, seulement l'annulation.
        if (awaitingPosition(current.locationRequest) && (data.driverId || (data.status && data.status !== "CANCELLED"))) {
          throw new HttpError(409, "En attente de la position du destinataire : le prix n'est pas encore fixé");
        }
        const closed = current.status === "DELIVERED" || current.status === "CANCELLED";
        if (closed && data.status && data.status !== current.status) {
          throw new HttpError(409, "Cette commande est déjà clôturée");
        }
        // Livreur d'une commande clôturée : sa part et ses espèces lui restent, on ne lui envoie pas de course.
        if (closed && data.driverId !== undefined && data.driverId !== current.driverId) {
          throw new HttpError(409, "Cette commande est déjà clôturée : le livreur ne change plus");
        }
        // La zone est obligatoire : un colis sans zone (adresse écrite seule) n'est confié qu'une fois sa zone attribuée.
        const zoneId = data.zoneId ?? current.zoneId;
        if (data.zoneId !== undefined && (data.zoneId === PARCEL_ZONE_ID || !(await prisma.zone.findFirst({ where: { id: data.zoneId, active: true } })))) {
          throw new HttpError(400, "Zone inconnue");
        }
        if (zoneId === PARCEL_ZONE_ID && data.driverId) throw new HttpError(409, "Attribuez d'abord la zone de livraison");

        const update: Prisma.OrderUncheckedUpdateInput = {};
        if (data.zoneId !== undefined) update.zoneId = data.zoneId;
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
        const deliveryFee = data.deliveryFee ?? current.deliveryFee;
        if (data.discount !== undefined || data.extraFee !== undefined || data.deliveryFee !== undefined) {
          if (closed) throw new HttpError(409, "Montants non modifiables sur une commande clôturée");
          const total = orderTotal({ ...current, discount, deliveryFee, extraFee });
          if (total < 0) throw new HttpError(400, "La remise dépasse le montant de la commande");
          Object.assign(update, { discount, extraFee, deliveryFee, total });
        }

        if (data.status && data.status !== current.status) {
          Object.assign(
            update,
            await statusUpdate(prisma, current, data.status, { reason: data.cancellationReason, extraFee, deliveryFee }),
          );
        }

        // Changement d'étape : écrit seulement si personne n'a changé l'étape entre-temps (restaurant, livreur, client).
        // Sans ce verrou, l'admin pouvait par exemple clôturer une commande que le restaurant venait d'annuler, et
        // l'étape et ses montants (dépôt, part du livreur) étaient calculés deux fois.
        const guard = data.status && data.status !== current.status ? { status: current.status } : {};
        const { count } = await prisma.order.updateMany({ where: { id, ...guard }, data: update as Prisma.OrderUncheckedUpdateManyInput });
        if (!count) throw new HttpError(409, "La commande vient de changer : rechargez-la");
        const saved = await prisma.order.findUniqueOrThrow({ where: { id }, include: listInclude });
        if (update.paidFromDeposit && current.restaurantId) void alertLowDeposit(prisma, notifier, current.restaurantId);
        if (data.status && data.status !== current.status) notifyCustomer(notifier, saved, data.status);
        if (data.driverId !== undefined) await assignDriver(prisma, notifier, current, data.driverId, staffName(res));
        return saved;
      },
      { partial: true },
    ),
  );

  // Répartition : commandes à affecter, en cours, et livreurs disponibles.
  router.get("/dispatch", async (_req, res) => {
    const withAssignment = { ...listInclude, assignments: { orderBy: { createdAt: "desc" }, take: 1, select: assignmentSelect } } satisfies Prisma.OrderInclude;
    const [unanswered, unassigned, ongoing, drivers, issues, settings] = await Promise.all([
      // Commandes que le restaurant n'a pas acceptées à temps (alerte envoyée par la boucle de relance).
      prisma.order.findMany({ where: { status: "PENDING", alertedAdminAt: { not: null } }, orderBy: { createdAt: "asc" }, include: listInclude }),
      prisma.order.findMany({
        // Repas : visibles une fois prêts au restaurant. Colis : dès la demande.
        where: {
          status: { in: OPEN },
          driverId: null,
          fulfillment: "DELIVERY",
          OR: [{ type: "PARCEL" }, { status: { in: ["READY", "PICKED_UP"] } }],
          // Colis en attente de la position du destinataire : pas encore à répartir.
          NOT: { locationRequest: { status: { in: AWAITING } } },
        },
        orderBy: { createdAt: "asc" },
        include: withAssignment,
      }),
      prisma.order.findMany({
        where: { status: { in: OPEN }, driverId: { not: null }, fulfillment: "DELIVERY" },
        orderBy: { createdAt: "asc" },
        include: withAssignment,
      }),
      prisma.driver.findMany({
        // Les conducteurs Zed inscrits seuls ne font pas de livraisons.
        where: { active: true, status: "APPROVED", deliveries: true },
        orderBy: [{ online: "desc" }, { name: "asc" }],
        include: { zone: { select: { name: true } }, _count: { select: { orders: { where: { status: { in: OPEN } } } } } },
      }),
      prisma.driverIssue.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: "asc" },
        include: { driver: { select: { name: true, phone: true } }, order: { select: { id: true, code: true } } },
      }),
      prisma.settings.findUnique({ where: { id: 1 }, select: { autoDispatchEnabled: true, autoDispatchMaxTries: true } }),
    ]);
    // Carte de la répartition (planche 4) : restaurants, point de départ de chaque course, note des livreurs et
    // compteurs (en cuisine, en retard : préparation au-delà du temps annoncé ou prête depuis plus de 15 min).
    const now = Date.now();
    const [restaurants, kitchen, ratings] = await Promise.all([
      prisma.restaurant.findMany({ where: { active: true, latitude: { not: null }, longitude: { not: null } }, select: { id: true, name: true, latitude: true, longitude: true } }),
      prisma.order.findMany({ where: { status: { in: ["CONFIRMED", "PREPARING"] } }, select: { confirmedAt: true, preparingAt: true, prepMinutes: true } }),
      prisma.order.groupBy({ by: ["driverId"], where: { driverId: { in: drivers.map((d) => d.id) }, driverRating: { not: null } }, _avg: { driverRating: true } }),
    ]);
    const where = new Map(restaurants.map((r) => [r.id, r]));
    const pickup = (o: { id: string; restaurantId: string | null; pickupLatitude: number | null; pickupLongitude: number | null }) => {
      const r = o.restaurantId ? where.get(o.restaurantId) : null;
      const lat = r?.latitude ?? o.pickupLatitude;
      const lng = r?.longitude ?? o.pickupLongitude;
      return lat != null && lng != null ? { latitude: lat, longitude: lng } : null;
    };
    const lateKitchen = kitchen.filter((o) => {
      const start = (o.preparingAt ?? o.confirmedAt)?.getTime();
      return start && o.prepMinutes && now - start > o.prepMinutes * 60_000;
    }).length;
    const lateReady = [...unassigned, ...ongoing].filter((o) => o.status === "READY" && o.readyAt && now - o.readyAt.getTime() > 15 * 60_000).length;
    res.json({
      map: {
        restaurants,
        pickups: Object.fromEntries([...unassigned, ...ongoing].map((o) => [o.id, pickup(o)])),
        ratings: Object.fromEntries(ratings.map((r) => [r.driverId, r._avg.driverRating != null ? Math.round(r._avg.driverRating * 10) / 10 : null])),
        counts: { kitchen: kitchen.length, late: lateKitchen + lateReady },
      },
      unanswered,
      unassigned,
      ongoing,
      // Le salaire n'est montré qu'au directeur.
      drivers: drivers.map(({ _count, monthlySalary, ...d }) => ({ ...withoutPin(d), activeOrders: _count.orders, ...(isDirector(res) ? { monthlySalary } : {}) })),
      issues: issues.map((i) => ({ ...i, label: ISSUE_KINDS[i.kind as keyof typeof ISSUE_KINDS] ?? i.kind })),
      autoDispatch: {
        enabled: settings?.autoDispatchEnabled ?? false,
        maxTries: settings?.autoDispatchMaxTries ?? 3,
        name: AUTO_DISPATCH_NAME,
        canToggle: staffRole(res) !== "DISPATCHER",
      },
    });
  });

  // Attribution automatique : marche/arrêt et nombre de propositions par commande (directeur et managerins).
  router.put(
    "/dispatch/auto",
    write(
      z.object({ enabled: z.boolean(), maxTries: z.number().int().min(1).max(10) }),
      async (data, _id, res) => {
        if (staffRole(res) === "DISPATCHER") throw new HttpError(403, "Réservé au directeur et aux managerins");
        const update = {
          ...(data.enabled !== undefined && { autoDispatchEnabled: data.enabled }),
          ...(data.maxTries !== undefined && { autoDispatchMaxTries: data.maxTries }),
        };
        const s = await prisma.settings.upsert({ where: { id: 1 }, update, create: { id: 1, ...update } });
        return { enabled: s.autoDispatchEnabled, maxTries: s.autoDispatchMaxTries };
      },
      { partial: true },
    ),
  );

  router.post("/dispatch/issues/:id/resolve", async (req, res) => {
    const { count } = await prisma.driverIssue.updateMany({ where: { id: req.params.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
    res.status(count ? 200 : 404).json(count ? { ok: true } : { error: "Signalement introuvable" });
  });

  return router;
}
