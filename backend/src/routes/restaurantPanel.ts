import { createHash } from "node:crypto";
import { Router, type Response } from "express";
import type { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import { distanceKm } from "../delivery.js";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { issueToken, requireRestaurant, tokenIssuedAt } from "../auth.js";
import { availability, openingHoursInput, parseHours } from "../openingHours.js";
import { restaurantPromoCost } from "./adminFinance.js";
import { canRestaurantMove, owedSubtotal, SETTLED_BY_STATEMENT, STATUSES, statusUpdate, stepView } from "../orderFlow.js";
import { startOfDayUtc } from "../stats.js";
import { tablesRouter } from "../tables.js";
import { activeTableCalls, tableCallPanelRouter } from "../tableCalls.js";
import { alertLowDeposit, depositBalance, depositMovements } from "../deposit.js";
import { getSettings, webUrl } from "../util.js";
import { addonInput, itemAddonsInput, menuItemInput, variantsInput } from "./adminCatalog.js";
import { listInclude, listWhere } from "./adminOrders.js";
import { HttpError, write } from "./adminWrite.js";
import type { Notifier } from "../notify.js";
import type { FileStore } from "../storage.js";
import { rawImage, storeMenuImage } from "./menuImages.js";
import { EDITABLE_STATUSES, planOrderEdit } from "../partner.js";
import { notifyCustomer } from "../customerNotify.js";
import type { EmailSender } from "../email.js";
import { newPassword, partnerPrivateRoutes, partnerPublicRouter, sessionGuard, type PartnerStore } from "./partnerAccount.js";
import { actorOf, mayManageMember, OWNER_SETTINGS_FIELDS, restaurantActorGuard } from "../restaurantTeam.js";
import { firstError } from "../util.js";

// Espace restaurant : chaque route ne voit que les données du restaurant connecté.

const settingsInput = z.object({
  temporarilyClosed: z.boolean(),
  openingHours: openingHoursInput,
  minOrderAmount: z.number().int().min(0).max(1_000_000),
  tableCallsEnabled: z.boolean(),
  deliveryTimeMin: z.number().int().min(5).max(180),
  deliveryTimeMax: z.number().int().min(5).max(240),
  phone: z.string().trim().regex(/^\+?[0-9 ]{8,15}$/, "Numéro de téléphone invalide"),
  address: z.string().trim().min(2),
  logoUrl: webUrl.nullable(),
});

const actionInput = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "READY", "DELIVERED", "CANCELLED"]),
  prepMinutes: z.number().int().min(1).max(240),
  reason: z.string().trim().min(3).max(300),
});

const me = (res: Response) => String(res.locals.restaurantId);

// Commande vue par le restaurant : étape par étape, sans la part Zedeka du livreur ni le détail des encaissements.
const forRestaurant = <T extends Parameters<typeof stepView>[0] & { driverEarning?: number; cashCollectionId?: string | null }>({ driverEarning: _d, cashCollectionId: _c, ...o }: T) => stepView(o);

// Livreur vu par le restaurant : plaque et, d'après sa dernière position (moins de 10 min), minutes avant
// d'arriver (environ 3,4 min par km en ville) ou « au restaurant » à moins de 150 m.
const panelInclude = {
  ...listInclude,
  driver: { select: { id: true, name: true, phone: true, plate: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true } },
} satisfies Prisma.OrderInclude;
type PanelDriver = { id: string; name: string; phone: string; plate: string | null; lastLatitude: number | null; lastLongitude: number | null; lastLocationAt: Date | null };
function driverView(d: PanelDriver | null | undefined, at: { latitude: number | null; longitude: number | null } | null, now = Date.now()) {
  if (!d) return null;
  const { lastLatitude, lastLongitude, lastLocationAt, ...rest } = d;
  const place = at?.latitude != null && at.longitude != null ? { latitude: at.latitude, longitude: at.longitude } : null;
  const fresh = place && lastLatitude != null && lastLongitude != null && lastLocationAt && now - lastLocationAt.getTime() < 10 * 60_000;
  const km = fresh ? distanceKm(place, { latitude: lastLatitude, longitude: lastLongitude }) : null;
  return { ...rest, atRestaurant: km != null && km < 0.15, etaMin: km == null ? null : Math.max(1, Math.round(km * 3.4)) };
}

const editInput = z.object({
  reason: z.string().trim().min(3, "Indiquez la raison (ex. plus de poulet)").max(200),
  changes: z
    .array(z.object({ itemId: z.string().min(1), quantity: z.number().int().min(0), replacementId: z.string().min(1).optional() }))
    .min(1)
    .max(30),
});

type Config = { secret: string; notifier: Notifier; devCodes: boolean; files?: FileStore; frontendOrigin?: string; email?: EmailSender };

// Étapes du restaurant annoncées à l'équipe (refus et commande prête : alarme pour la répartition).
const RESTAURANT_STEP: Partial<Record<string, { title: string; alarm: boolean }>> = {
  CONFIRMED: { title: "Acceptée par le restaurant", alarm: false },
  PREPARING: { title: "En préparation", alarm: false },
  READY: { title: "Prête à récupérer", alarm: true },
  CANCELLED: { title: "Refusée par le restaurant", alarm: true },
};

// Commandes encore au restaurant (compteurs du menu, tableau « En direct »).
export const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "PREPARING", "READY"] as const;

// Empreinte des commandes en cours : change dès qu'une commande arrive, change d'étape, est payée, reçoit un livreur,
// est modifiée ou qu'un message part au livreur. Même empreinte : rien à relire.
export function pulseVersion(
  rows: { id: string; status: string; paymentStatus: string; driverId: string | null; total: number; restaurantMessageAt: Date | null }[],
): string {
  const text = rows.map((o) => [o.id, o.status, o.paymentStatus, o.driverId ?? "", o.total, o.restaurantMessageAt?.getTime() ?? ""].join(":")).join("|");
  return createHash("sha256").update(text).digest("base64url").slice(0, 16);
}

// Messages courts envoyés au livreur depuis la caisse ou la fiche de commande.
export const DRIVER_MESSAGES = {
  READY_SOON: "La commande sera prête dans quelques minutes.",
  READY: "La commande est prête, vous pouvez venir la chercher.",
  WAITING: "Nous vous attendons au comptoir.",
} as const;

// « Prête » sur une livraison avec un livreur déjà affecté : il est prévenu dans le même geste.
export function shouldTellDriverReady(o: { driverId: string | null; fulfillment: string; tableNumber: number | null }) {
  return !!o.driverId && o.fulfillment === "DELIVERY" && o.tableNumber == null;
}

export function restaurantPanelRouter(prisma: PrismaClient, config: Config) {
  const router = Router();
  const store: PartnerStore = {
    byId: (id) => prisma.restaurant.findUnique({ where: { id } }),
    byEmail: (email) => prisma.restaurant.findUnique({ where: { ownerEmail: email } }),
    update: (id, data) => prisma.restaurant.update({ where: { id }, data }),
  };
  const deps = { prisma, role: "restaurant" as const, secret: config.secret, notifier: config.notifier, devCodes: config.devCodes, email: config.email, store, subject: me };

  router.post("/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const restaurant = email ? await prisma.restaurant.findUnique({ where: { ownerEmail: email } }) : null;
    const ok = restaurant?.ownerPasswordHash ? await bcrypt.compare(password, restaurant.ownerPasswordHash) : false;
    if (restaurant && ok && config.secret) {
      res.json({ token: issueToken(config.secret, Date.now(), "restaurant", restaurant.id), name: restaurant.name, role: "OWNER" });
      return;
    }
    // Sinon, un membre de l'équipe (caissière, manageuse) avec son propre e-mail.
    const member = email && !restaurant ? await prisma.restaurantStaff.findUnique({ where: { email }, include: { restaurant: { select: { name: true } } } }) : null;
    const memberOk = member?.active ? await bcrypt.compare(password, member.passwordHash) : false;
    if (!member || !memberOk || !config.secret) {
      res.status(401).json({ error: "E-mail ou mot de passe incorrect" });
      return;
    }
    await prisma.restaurantStaff.update({ where: { id: member.id }, data: { lastLoginAt: new Date() } });
    res.json({ token: issueToken(config.secret, Date.now(), "restaurant", member.restaurantId, undefined, member.id), name: member.restaurant.name, role: member.role, memberName: member.name });
  });

  router.use(partnerPublicRouter(deps));
  const ownerSessions = sessionGuard(deps);
  router.use(
    requireRestaurant(config.secret),
    // Le gérant : « se déconnecter partout » et son mot de passe ; un membre : son propre compte (restaurantActorGuard).
    (req, res, next) => (res.locals.restaurantMemberId ? next() : ownerSessions(req, res, next)),
    restaurantActorGuard(prisma, (req) => tokenIssuedAt(req, config.secret)),
  );

  // Mot de passe et sessions d'un membre de l'équipe : les siens, jamais ceux du gérant.
  router.post("/password", async (req, res, next) => {
    const actor = actorOf(res);
    if (!actor.memberId) return next();
    const parsed = z.object({ current: z.string().min(1, "Mot de passe actuel requis"), password: newPassword }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const m = await prisma.restaurantStaff.findUniqueOrThrow({ where: { id: actor.memberId } });
    if (!(await bcrypt.compare(parsed.data.current, m.passwordHash))) {
      res.status(400).json({ error: "Mot de passe actuel incorrect" });
      return;
    }
    const now = new Date();
    await prisma.restaurantStaff.update({ where: { id: m.id }, data: { passwordHash: await bcrypt.hash(parsed.data.password, 10), sessionsValidFrom: now } });
    res.json({ token: issueToken(config.secret, now.getTime(), "restaurant", me(res), undefined, m.id) });
  });
  router.post("/sessions/logout-all", async (_req, res, next) => {
    const actor = actorOf(res);
    if (!actor.memberId) return next();
    await prisma.restaurantStaff.update({ where: { id: actor.memberId }, data: { sessionsValidFrom: new Date() } });
    res.status(204).end();
  });

  partnerPrivateRoutes(router, deps, "/restaurant");

  // Vérifie qu'un plat, un supplément ou une commande appartient bien au restaurant connecté.
  const own = async (kind: "menuItem" | "addon" | "order", id: string, res: Response) => {
    const row =
      kind === "menuItem"
        ? await prisma.menuItem.findUnique({ where: { id }, select: { restaurantId: true } })
        : kind === "addon"
          ? await prisma.addon.findUnique({ where: { id }, select: { restaurantId: true } })
          : await prisma.order.findUnique({ where: { id }, select: { restaurantId: true } });
    if (!row || row.restaurantId !== me(res)) throw new HttpError(404, "Introuvable");
  };

  router.get("/me", async (_req, res) => {
    const r = await prisma.restaurant.findUnique({
      where: { id: me(res) },
      omit: { ownerPasswordHash: true, sessionsValidFrom: true },
      include: { zone: { select: { name: true } } },
    });
    if (!r) {
      res.status(401).json({ error: "Connexion requise" });
      return;
    }
    const actor = actorOf(res);
    const member = actor.memberId ? await prisma.restaurantStaff.findUnique({ where: { id: actor.memberId }, select: { email: true } }) : null;
    // La caissière ne voit ni les conditions commerciales ni l'e-mail du gérant.
    const { commissionRate, subscriptionFee, ownerEmail, ...rest } = r;
    const terms = actor.role === "CASHIER" ? {} : { commissionRate, subscriptionFee, ownerEmail };
    res.json({ ...rest, ...terms, openingHours: parseHours(r.openingHours), availability: availability(r), account: { role: actor.role, name: actor.name, email: member?.email ?? ownerEmail } });
  });

  router.get("/dashboard", async (_req, res) => {
    const today = startOfDayUtc(new Date());
    const weekStart = new Date(today.getTime() - 6 * 86_400_000);
    const [byStatus, week] = await Promise.all([
      prisma.order.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { restaurantId: me(res), OR: [{ createdAt: { gte: today } }, { status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] } }] },
      }),
      prisma.order.findMany({
        where: { restaurantId: me(res), createdAt: { gte: weekStart }, status: { not: "CANCELLED" } },
        select: { subtotal: true, commission: true, createdAt: true, discount: true, promoPayer: true, fulfillment: true, paymentMethod: true },
      }),
    ]);
    const sum = (rows: typeof week) => rows.reduce((s, o) => s + o.subtotal - o.commission - restaurantPromoCost(o), 0);
    const todayRows = week.filter((o) => o.createdAt >= today);
    // Tableau de bord (planche 9) : ventes par jour, préparation moyenne, note, plats les plus vendus (30 jours)
    // et coût des codes promo payés par le restaurant (30 jours).
    const monthStart = new Date(today.getTime() - 29 * 86_400_000);
    const [prepRows, rating, top, promos] = await Promise.all([
      prisma.order.findMany({
        where: { restaurantId: me(res), readyAt: { gte: weekStart }, confirmedAt: { not: null } },
        select: { confirmedAt: true, readyAt: true },
      }),
      prisma.order.aggregate({ where: { restaurantId: me(res), restaurantRating: { not: null } }, _avg: { restaurantRating: true }, _count: { restaurantRating: true } }),
      prisma.orderItem.groupBy({
        by: ["name"],
        where: { order: { restaurantId: me(res), createdAt: { gte: monthStart }, status: { not: "CANCELLED" } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 3,
      }),
      prisma.order.groupBy({
        by: ["promoCode"],
        where: { restaurantId: me(res), createdAt: { gte: monthStart }, promoPayer: "RESTAURANT", promoCode: { not: null }, status: { not: "CANCELLED" } },
        _count: { _all: true },
        _sum: { discount: true },
      }),
    ]);
    const prep = prepRows.map((o) => (o.readyAt!.getTime() - o.confirmedAt!.getTime()) / 60_000).filter((m) => m > 0 && m < 240);
    const days = Array.from({ length: 7 }, (_, i) => {
      const start = new Date(weekStart.getTime() + i * 86_400_000);
      const end = new Date(start.getTime() + 86_400_000);
      return { date: start.toISOString().slice(0, 10), sales: week.filter((o) => o.createdAt >= start && o.createdAt < end).reduce((s, o) => s + o.subtotal, 0) };
    });
    res.json({
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((g) => g.status === s)?._count._all ?? 0])),
      today: { orders: todayRows.length, sales: todayRows.reduce((s, o) => s + o.subtotal, 0), net: sum(todayRows) },
      week: { orders: week.length, sales: week.reduce((s, o) => s + o.subtotal, 0), net: sum(week) },
      days,
      prepMinutes: prep.length ? Math.round(prep.reduce((a, b) => a + b, 0) / prep.length) : null,
      rating: { average: rating._avg.restaurantRating != null ? Math.round(rating._avg.restaurantRating * 10) / 10 : null, count: rating._count.restaurantRating },
      topItems: top.map((t) => ({ name: t.name, quantity: t._sum.quantity ?? 0 })),
      promos: promos.map((p) => ({ code: p.promoCode, uses: p._count._all, cost: p._sum.discount ?? 0 })),
    });
  });

  // --- Commandes ---

  router.get("/orders", async (req, res) => {
    const where: Prisma.OrderWhereInput = { ...listWhere(req.query), restaurantId: me(res) };
    // Tableau « En direct » : toutes les commandes encore au restaurant.
    if (req.query.active === "1") where.status = { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] };
    const [orders, place] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: panelInclude }),
      prisma.restaurant.findUnique({ where: { id: me(res) }, select: { latitude: true, longitude: true } }),
    ]);
    // Comme pour le détail : ni la part du livreur ni le détail des encaissements.
    res.json(orders.map((o) => ({ ...forRestaurant(o), driver: o.status === "PENDING" ? null : driverView(o.driver, place) })));
  });

  // Pouls de l'espace restaurant : un seul appel léger, toutes les quelques secondes, au lieu de plusieurs minuteries
  // (compteurs du menu, alarme des tables, listes de la caisse et du tableau). Les écrans ne relisent leurs listes
  // complètes que quand « version » change. Une lecture de la base pour les commandes en cours, une pour les appels.
  router.get("/pulse", async (_req, res) => {
    const now = Date.now();
    const [active, calls] = await Promise.all([
      prisma.order.findMany({
        where: { restaurantId: me(res), status: { in: [...ACTIVE_STATUSES] } },
        orderBy: { id: "asc" },
        select: { id: true, status: true, paymentStatus: true, driverId: true, total: true, restaurantMessageAt: true },
      }),
      activeTableCalls(prisma, me(res), now),
    ]);
    const counts = Object.fromEntries(ACTIVE_STATUSES.map((s) => [s, active.filter((o) => o.status === s).length]));
    res.json({ counts, version: pulseVersion(active), calls });
  });

  router.get("/orders/counts", async (req, res) => {
    const { status: _ignored, ...rest } = req.query;
    const groups = await prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { ...listWhere(rest), restaurantId: me(res) },
    });
    const counts = Object.fromEntries(STATUSES.map((s) => [s, groups.find((g) => g.status === s)?._count._all ?? 0]));
    res.json({ ...counts, ALL: groups.reduce((sum, g) => sum + g._count._all, 0) });
  });

  router.get("/orders/:id", async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, restaurantId: me(res) },
      include: {
        ...panelInclude,
        restaurant: { select: { name: true, phone: true, latitude: true, longitude: true } },
        items: { select: { id: true, menuItemId: true, name: true, variantName: true, addons: true, quantity: true, unitPrice: true } },
        edits: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    // Le restaurant n'a pas à voir la part Zedeka du livreur ni le détail des encaissements.
    const { driverEarning: _d, cashCollectionId: _c, ...visible } = order;
    const shown = stepView(visible);
    const driver = shown.driver ? driverView(order.driver, order.restaurant) : null;
    // Note moyenne du livreur sur ses courses notées.
    const rated = driver ? await prisma.order.aggregate({ where: { driverId: driver.id, driverRating: { not: null } }, _avg: { driverRating: true } }) : null;
    const rating = rated?._avg.driverRating != null ? Math.round(rated._avg.driverRating * 10) / 10 : null;
    res.json({ ...shown, restaurant: order.restaurant && { name: order.restaurant.name, phone: order.restaurant.phone }, driver: driver && { ...driver, rating } });
  });

  router.post(
    "/orders/:id/status",
    write(
      actionInput,
      async (data, id, res) => {
        await own("order", id, res);
        const current = await prisma.order.findUniqueOrThrow({ where: { id } });
        if (!data.status || !canRestaurantMove(current.status, data.status as OrderStatus, current.fulfillment)) {
          throw new HttpError(409, "Action impossible à ce stade de la commande");
        }
        const update = await statusUpdate(prisma, current, data.status, { reason: data.reason, prepMinutes: data.prepMinutes, byRestaurant: true });
        if (current.status === "PENDING" && (data.status === "CONFIRMED" || data.status === "PREPARING")) {
          const actor = actorOf(res);
          Object.assign(update, { confirmedBy: actor.name, confirmedByRole: actor.role });
        }
        // Écrite seulement si personne n'a changé la commande entre-temps (annulée par Zedeka, autre écran).
        const { count } = await prisma.order.updateMany({ where: { id, status: current.status }, data: update as never });
        if (!count) throw new HttpError(409, "La commande vient de changer : rechargez-la");
        const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: listInclude });
        if (update.paidFromDeposit) void alertLowDeposit(prisma, config.notifier, me(res));
        notifyCustomer(config.notifier, order, data.status as OrderStatus);
        const name = order.restaurant?.name ?? "Le restaurant";
        const step = RESTAURANT_STEP[data.status];
        if (step) {
          void config.notifier.staff("RESTAURANTS", {
            title: `${step.title} : ${order.code}`,
            body: data.status === "CANCELLED" ? `${name} : ${data.reason || "sans motif"}` : data.prepMinutes ? `${name} · prête dans ${data.prepMinutes} min` : name,
            url: data.status === "READY" ? "/admin/dispatch" : `/admin/commandes/${order.id}`,
            tag: `restaurant-${order.id}`,
            alarm: step.alarm,
          });
        }
        // « Prête » prévient aussi le livreur déjà affecté : plus besoin d'un second geste « Prévenir le livreur ».
        if (data.status === "READY" && shouldTellDriverReady(order)) {
          await prisma.order.update({ where: { id }, data: { restaurantMessage: DRIVER_MESSAGES.READY, restaurantMessageAt: new Date() } });
          void config.notifier
            .push("driver", order.driverId!, { title: `${name} · ${order.code}`, body: DRIVER_MESSAGES.READY, url: `/livreur/course/${order.id}`, tag: `restaurant-message-${order.id}` })
            .catch(() => 0);
        }
        return forRestaurant(order);
      },
      { partial: true },
    ),
  );

  // Modification d'une commande avant « Prête » : article manquant, quantité réduite, remplacement au même prix
  // ou moins cher. « quote » calcule sans enregistrer ; l'autre route enregistre et garde la trace dans OrderEdit.
  async function planEdit(id: string, body: unknown, res: Response) {
    const parsed = editInput.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Données invalides");
    const order = await prisma.order.findFirst({ where: { id, restaurantId: me(res) }, include: { items: true } });
    if (!order) throw new HttpError(404, "Commande introuvable");
    if (!EDITABLE_STATUSES.includes(order.status)) throw new HttpError(409, "La commande ne peut plus être modifiée");
    const ids = parsed.data.changes.map((c) => c.replacementId).filter((x): x is string => Boolean(x));
    const replacements = await prisma.menuItem.findMany({ where: { id: { in: ids }, restaurantId: me(res), available: true }, select: { id: true, name: true, price: true } });
    let plan;
    try {
      plan = planOrderEdit(order.items, parsed.data.changes, replacements);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: me(res) }, select: { commissionRate: true } });
    const discount = Math.min(order.discount, plan.subtotal);
    const total = plan.subtotal - discount + order.deliveryFee + order.extraFee;
    // Mobile money : la différence est à rembourser au client.
    const refund = order.paymentMethod === "MOBILE_MONEY" ? Math.max(0, order.total - total) : 0;
    return { order, plan, reason: parsed.data.reason, discount, total, refund, commission: order.tableNumber !== null ? 0 : Math.round((plan.subtotal * restaurant.commissionRate) / 100) };
  }

  router.post("/orders/:id/edit/quote", async (req, res) => {
    try {
      const q = await planEdit(req.params.id, req.body, res);
      res.json({ changes: q.plan.changes, subtotal: q.plan.subtotal, oldTotal: q.order.total, total: q.total, refund: q.refund });
    } catch (e) {
      if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
      else throw e;
    }
  });

  router.post("/orders/:id/edit", async (req, res) => {
    try {
      const q = await planEdit(req.params.id, req.body, res);
      const { order, plan } = q;
      // Verrou : la commande n'est réécrite que si elle n'a changé ni d'étape ni de montant depuis la lecture.
      // Deux écrans qui modifient en même temps (ou « Prête » pendant la modification) : le second reçoit 409
      // au lieu de supprimer deux fois les mêmes lignes et de compter deux fois le remboursement.
      const { count } = await prisma.order.updateMany({
        where: { id: order.id, restaurantId: me(res), status: { in: EDITABLE_STATUSES as OrderStatus[] }, total: order.total, subtotal: order.subtotal },
        data: { subtotal: plan.subtotal, discount: q.discount, total: q.total, commission: q.commission, refundDue: { increment: q.refund } },
      });
      if (!count) throw new HttpError(409, "La commande vient de changer : rechargez-la");
      await prisma.$transaction([
        ...plan.updates.map((u) => (u.quantity === 0 ? prisma.orderItem.delete({ where: { id: u.id } }) : prisma.orderItem.update({ where: { id: u.id }, data: { quantity: u.quantity } }))),
        ...plan.additions.map((a) => prisma.orderItem.create({ data: { ...a, orderId: order.id } })),
        prisma.orderEdit.create({ data: { orderId: order.id, reason: q.reason, changes: plan.changes, oldTotal: order.total, newTotal: q.total, refund: q.refund } }),
      ]);
      await config.notifier.staff("ORDERS", {
        title: `Commande ${order.code} modifiée`,
        body: `${q.reason} · nouveau total ${q.total} FCFA${q.refund ? `, ${q.refund} FCFA à rembourser` : ""}`,
        url: `/admin/commandes/${order.id}`,
        tag: `edit-${order.id}`,
      });
      res.json({ total: q.total, refund: q.refund });
    } catch (e) {
      if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
      else throw e;
    }
  });

  // --- Caisse : encaissement au comptoir et messages au livreur ---

  // Espèces reçues au comptoir (retrait ou sur place) : la commande est payée, on garde qui a encaissé.
  // Une livraison est payée au livreur, pas au comptoir.
  router.post("/orders/:id/paid", async (req, res) => {
    const order = await prisma.order.findFirst({ where: { id: req.params.id, restaurantId: me(res) } });
    if (!order) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    if (order.fulfillment !== "PICKUP" || order.status === "CANCELLED" || order.status === "PENDING") {
      res.status(409).json({ error: "Encaissement au comptoir impossible pour cette commande" });
      return;
    }
    if (order.paymentStatus === "PAID") {
      res.status(409).json({ error: "Commande déjà payée" });
      return;
    }
    // Deux caisses qui encaissent en même temps, ou commande annulée entre-temps : une seule écriture passe.
    const { count } = await prisma.order.updateMany({
      where: { id: order.id, paymentStatus: { not: "PAID" }, status: { notIn: ["CANCELLED", "PENDING"] } },
      data: { paymentStatus: "PAID", counterPaidBy: actorOf(res).name, counterPaidAt: new Date() },
    });
    if (!count) {
      res.status(409).json({ error: "La commande vient de changer : rechargez-la" });
      return;
    }
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: listInclude });
    res.json(forRestaurant(updated));
  });

  // Message rapide au livreur de la commande (notification sur son téléphone).
  router.post("/orders/:id/driver-message", async (req, res) => {
    const parsed = z
      .object({ kind: z.enum(["READY_SOON", "READY", "WAITING", "CUSTOM"]), text: z.string().trim().min(2).max(160).optional() })
      .refine((v) => v.kind !== "CUSTOM" || !!v.text, "Écrivez le message")
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const order = await prisma.order.findFirst({ where: { id: req.params.id, restaurantId: me(res) }, include: { restaurant: { select: { name: true } } } });
    if (!order) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    if (!order.driverId || !["CONFIRMED", "PREPARING", "READY"].includes(order.status)) {
      res.status(409).json({ error: "Aucun livreur à prévenir pour cette commande" });
      return;
    }
    const body = parsed.data.kind === "CUSTOM" ? parsed.data.text! : DRIVER_MESSAGES[parsed.data.kind];
    // Gardé sur la commande : l'accueil du livreur le montre même sans notification.
    await prisma.order.update({ where: { id: order.id }, data: { restaurantMessage: body, restaurantMessageAt: new Date() } });
    const sent = await config.notifier.push("driver", order.driverId, {
      title: `${order.restaurant?.name ?? "Restaurant"} · ${order.code}`,
      body,
      url: `/livreur/course/${order.id}`,
      tag: `restaurant-message-${order.id}`,
    });
    res.json({ sent });
  });

  // --- Équipe du restaurant (gérant et manageuse) ---

  const memberSelect = { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true } as const;
  const memberInput = z.object({
    name: z.string().trim().min(2, "Nom : 2 caractères minimum").max(80),
    email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(120),
    password: newPassword,
    role: z.enum(["MANAGER", "CASHIER"]).default("CASHIER"),
    active: z.boolean().default(true),
  });
  const teamOnly = (res: Response) => {
    if (actorOf(res).role === "CASHIER") throw new HttpError(403, "Accès réservé au gérant ou à la manageuse");
  };
  // Une adresse sert à une seule connexion : ni celle d'un gérant, ni celle d'un autre membre.
  const emailFree = async (email: string) => {
    if (await prisma.restaurant.findUnique({ where: { ownerEmail: email }, select: { id: true } })) {
      throw new HttpError(409, "Cette adresse est déjà utilisée par un compte restaurant");
    }
  };

  router.get("/team", async (_req, res) => {
    if (actorOf(res).role === "CASHIER") {
      res.status(403).json({ error: "Accès réservé au gérant ou à la manageuse" });
      return;
    }
    res.json(await prisma.restaurantStaff.findMany({ where: { restaurantId: me(res) }, orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }], select: memberSelect }));
  });

  router.post(
    "/team",
    write(memberInput, async ({ password, ...data }, _id, res) => {
      teamOnly(res);
      if (!mayManageMember(actorOf(res).role, data.role)) throw new HttpError(403, "Seul le gérant ajoute une manageuse");
      await emailFree(data.email);
      const count = await prisma.restaurantStaff.count({ where: { restaurantId: me(res) } });
      if (count >= 30) throw new HttpError(400, "30 membres au maximum");
      return prisma.restaurantStaff.create({ data: { ...data, restaurantId: me(res), passwordHash: await bcrypt.hash(password, 10) }, select: memberSelect });
    }),
  );

  router.patch(
    "/team/:id",
    write(
      memberInput,
      async ({ password, ...data }, id, res) => {
        teamOnly(res);
        const actor = actorOf(res);
        const target = await prisma.restaurantStaff.findFirst({ where: { id, restaurantId: me(res) } });
        if (!target) throw new HttpError(404, "Membre introuvable");
        if (!mayManageMember(actor.role, target.role) || (data.role && !mayManageMember(actor.role, data.role))) {
          throw new HttpError(403, "Seul le gérant gère les manageuses");
        }
        if (data.email && data.email !== target.email) await emailFree(data.email);
        // Mot de passe changé ou compte désactivé : les sessions ouvertes du membre sont fermées.
        const revoke = password || data.active === false || (data.role && data.role !== target.role);
        return prisma.restaurantStaff.update({
          where: { id },
          data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}), ...(revoke ? { sessionsValidFrom: new Date() } : {}) },
          select: memberSelect,
        });
      },
      { partial: true },
    ),
  );

  router.delete("/team/:id", async (req, res) => {
    const actor = actorOf(res);
    const target = await prisma.restaurantStaff.findFirst({ where: { id: req.params.id, restaurantId: me(res) } });
    if (!target) {
      res.status(404).json({ error: "Membre introuvable" });
      return;
    }
    if (!mayManageMember(actor.role, target.role)) {
      res.status(403).json({ error: "Seul le gérant gère les manageuses" });
      return;
    }
    await prisma.restaurantStaff.delete({ where: { id: target.id } });
    res.status(204).end();
  });

  // --- Carte ---

  router.get("/menu", async (_req, res) => {
    const [menuItems, addons] = await Promise.all([
      prisma.menuItem.findMany({
        where: { restaurantId: me(res) },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { variants: { orderBy: { sortOrder: "asc" } }, addons: { select: { id: true } } },
      }),
      prisma.addon.findMany({ where: { restaurantId: me(res) }, orderBy: { name: "asc" } }),
    ]);
    res.json({ menuItems, addons });
  });

  // Photo d'un plat envoyée depuis le téléphone ou l'ordinateur ; le lien renvoyé va ensuite dans imageUrl.
  router.post("/images", rawImage, async (req, res) => {
    if (!config.files) {
      res.status(503).json({ error: "Envoi de photos indisponible" });
      return;
    }
    await storeMenuImage(req, res, config.files, me(res), config.frontendOrigin ?? "");
  });

  router.post(
    "/items",
    write(menuItemInput, async (data, _id, res) => {
      const count = await prisma.menuItem.count({ where: { restaurantId: me(res) } });
      return prisma.menuItem.create({ data: { ...data, sortOrder: data.sortOrder || count, restaurantId: me(res) } });
    }),
  );
  router.patch(
    "/items/:id",
    write(
      menuItemInput,
      async (data, id, res) => {
        await own("menuItem", id, res);
        return prisma.menuItem.update({ where: { id }, data });
      },
      { partial: true },
    ),
  );
  router.put(
    "/items/:id/variants",
    write(
      variantsInput,
      async (data, id, res) => {
        await own("menuItem", id, res);
        await prisma.menuVariant.deleteMany({ where: { menuItemId: id } });
        await prisma.menuVariant.createMany({ data: (data.variants ?? []).map((v, i) => ({ ...v, sortOrder: i, menuItemId: id })) });
        return prisma.menuVariant.findMany({ where: { menuItemId: id }, orderBy: { sortOrder: "asc" } });
      },
      { partial: true },
    ),
  );
  router.put(
    "/items/:id/addons",
    write(
      itemAddonsInput,
      async (data, id, res) => {
        await own("menuItem", id, res);
        const addons = await prisma.addon.findMany({ where: { id: { in: data.addonIds ?? [] }, restaurantId: me(res) } });
        return prisma.menuItem.update({
          where: { id },
          data: { addons: { set: addons.map((a) => ({ id: a.id })) } },
          include: { addons: { select: { id: true } } },
        });
      },
      { partial: true },
    ),
  );
  router.post("/addons", write(addonInput, (data, _id, res) => prisma.addon.create({ data: { ...data, restaurantId: me(res) } })));
  router.patch(
    "/addons/:id",
    write(
      addonInput,
      async (data, id, res) => {
        await own("addon", id, res);
        return prisma.addon.update({ where: { id }, data });
      },
      { partial: true },
    ),
  );

  // --- Tables (commande sur place par QR code) ---

  router.use("/tables", tablesRouter(prisma, (_req, res) => me(res)));

  // --- Sonnerie de table : appels des clients assis (toute l'équipe, caissière comprise) ---

  router.use("/table-calls", tableCallPanelRouter(prisma, me, (res) => (actorOf(res).memberId ? actorOf(res).name : "")));

  // --- Réglages et relevés ---

  router.patch(
    "/settings",
    write(
      settingsInput,
      async (data, _id, res) => {
        const min = data.deliveryTimeMin;
        const max = data.deliveryTimeMax;
        if (min !== undefined && max !== undefined && min > max) throw new HttpError(400, "Le délai minimum dépasse le maximum");
        if (actorOf(res).role !== "OWNER" && OWNER_SETTINGS_FIELDS.some((f) => data[f] !== undefined)) {
          throw new HttpError(403, "Le numéro, l'adresse et le logo sont réservés au gérant");
        }
        const r = await prisma.restaurant.update({ where: { id: me(res) }, data: { ...data, ...(data.temporarilyClosed === false ? { closedUntil: null } : {}) }, omit: { ownerPasswordHash: true, sessionsValidFrom: true } });
        return { ...r, openingHours: parseHours(r.openingHours), availability: availability(r) };
      },
      { partial: true },
    ),
  );

  router.get("/settlements", async (_req, res) => {
    const [settlements, pending] = await Promise.all([
      prisma.restaurantSettlement.findMany({ where: { restaurantId: me(res) }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.order.findMany({
        where: { restaurantId: me(res), type: "FOOD", status: "DELIVERED", settlementId: null, ...SETTLED_BY_STATEMENT },
        select: { subtotal: true, commission: true, fulfillment: true, paymentMethod: true, discount: true, promoPayer: true },
      }),
    ]);
    // Ventes payées à Zedeka ; la commission des retraits encaissés au comptoir vient en déduction.
    const sales = pending.reduce((s, o) => s + owedSubtotal(o), 0);
    const commission = pending.reduce((s, o) => s + o.commission, 0);
    // Codes promo payés par le restaurant sur des commandes encaissées par Zedeka : retenus sur le versement.
    const promoCost = pending.reduce((s, o) => s + restaurantPromoCost(o), 0);
    const { subscriptionFee } = await prisma.restaurant.findUniqueOrThrow({ where: { id: me(res) }, select: { subscriptionFee: true } });
    // Dépôt Zedeka : solde et mouvements récents (vide tant que Zedeka n'a rien déposé).
    const [balance, movements, { depositLowThreshold }] = await Promise.all([depositBalance(prisma, me(res)), depositMovements(prisma, me(res)), getSettings(prisma)]);
    res.json({
      settlements,
      pending: { orders: pending.length, sales, commission, promoCost, amountDue: sales - commission - promoCost },
      subscriptionFee,
      deposit: { ...balance, low: balance.active && balance.balance < depositLowThreshold, threshold: depositLowThreshold, movements: balance.active ? movements : [] },
    });
  });

  return router;
}
