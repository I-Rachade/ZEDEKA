import { Router, type Response } from "express";
import type { OrderStatus, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { issueToken, requireRestaurant } from "../auth.js";
import { availability, parseHours } from "../openingHours.js";
import { canRestaurantMove, STATUSES, statusUpdate } from "../orderFlow.js";
import { startOfDayUtc } from "../stats.js";
import { webUrl } from "../util.js";
import { addonInput, itemAddonsInput, menuItemInput, variantsInput } from "./adminCatalog.js";
import { listInclude, listWhere } from "./adminOrders.js";
import { HttpError, write } from "./adminWrite.js";
import type { Notifier } from "../notify.js";
import { EDITABLE_STATUSES, planOrderEdit } from "../partner.js";
import { partnerPrivateRoutes, partnerPublicRouter, sessionGuard, type PartnerStore } from "./partnerAccount.js";

// Espace restaurant : chaque route ne voit que les données du restaurant connecté.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "heure au format HH:MM");

const settingsInput = z.object({
  temporarilyClosed: z.boolean(),
  openingHours: z.array(z.object({ day: z.number().int().min(0).max(6), open: hhmm, close: hhmm })).max(21),
  minOrderAmount: z.number().int().min(0).max(1_000_000),
  deliveryTimeMin: z.number().int().min(5).max(180),
  deliveryTimeMax: z.number().int().min(5).max(240),
  phone: z.string().trim().regex(/^\+?[0-9 ]{8,15}$/, "Numéro de téléphone invalide"),
  address: z.string().trim().min(2),
  logoUrl: webUrl.nullable(),
});

const actionInput = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "READY", "CANCELLED"]),
  prepMinutes: z.number().int().min(1).max(240),
  reason: z.string().trim().min(3).max(300),
});

const me = (res: Response) => String(res.locals.restaurantId);

const editInput = z.object({
  reason: z.string().trim().min(3, "Indiquez la raison (ex. plus de poulet)").max(200),
  changes: z
    .array(z.object({ itemId: z.string().min(1), quantity: z.number().int().min(0), replacementId: z.string().min(1).optional() }))
    .min(1)
    .max(30),
});

type Config = { secret: string; notifier: Notifier; devCodes: boolean };

// Étapes du restaurant annoncées à l'équipe (refus et commande prête : alarme pour la répartition).
const RESTAURANT_STEP: Partial<Record<string, { title: string; alarm: boolean }>> = {
  CONFIRMED: { title: "Acceptée par le restaurant", alarm: false },
  PREPARING: { title: "En préparation", alarm: false },
  READY: { title: "Prête à récupérer", alarm: true },
  CANCELLED: { title: "Refusée par le restaurant", alarm: true },
};

export function restaurantPanelRouter(prisma: PrismaClient, config: Config) {
  const router = Router();
  const store: PartnerStore = {
    byId: (id) => prisma.restaurant.findUnique({ where: { id } }),
    byEmail: (email) => prisma.restaurant.findUnique({ where: { ownerEmail: email } }),
    update: (id, data) => prisma.restaurant.update({ where: { id }, data }),
  };
  const deps = { prisma, role: "restaurant" as const, secret: config.secret, notifier: config.notifier, devCodes: config.devCodes, store, subject: me };

  router.post("/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const restaurant = email ? await prisma.restaurant.findUnique({ where: { ownerEmail: email } }) : null;
    const ok = restaurant?.ownerPasswordHash ? await bcrypt.compare(password, restaurant.ownerPasswordHash) : false;
    if (!restaurant || !ok || !config.secret) {
      res.status(401).json({ error: "E-mail ou mot de passe incorrect" });
      return;
    }
    res.json({ token: issueToken(config.secret, Date.now(), "restaurant", restaurant.id), name: restaurant.name });
  });

  router.use(partnerPublicRouter(deps));
  router.use(requireRestaurant(config.secret), sessionGuard(deps));
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
    res.json({ ...r, openingHours: parseHours(r.openingHours), availability: availability(r) });
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
        select: { subtotal: true, commission: true, createdAt: true },
      }),
    ]);
    const sum = (rows: typeof week) => rows.reduce((s, o) => s + o.subtotal - o.commission, 0);
    const todayRows = week.filter((o) => o.createdAt >= today);
    res.json({
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((g) => g.status === s)?._count._all ?? 0])),
      today: { orders: todayRows.length, sales: todayRows.reduce((s, o) => s + o.subtotal, 0), net: sum(todayRows) },
      week: { orders: week.length, sales: week.reduce((s, o) => s + o.subtotal, 0), net: sum(week) },
    });
  });

  // --- Commandes ---

  router.get("/orders", async (req, res) => {
    const where = { ...listWhere(req.query), restaurantId: me(res) };
    res.json(await prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: listInclude }));
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
        ...listInclude,
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
    res.json(visible);
  });

  router.post(
    "/orders/:id/status",
    write(
      actionInput,
      async (data, id, res) => {
        await own("order", id, res);
        const current = await prisma.order.findUniqueOrThrow({ where: { id } });
        if (!data.status || !canRestaurantMove(current.status, data.status as OrderStatus)) {
          throw new HttpError(409, "Action impossible à ce stade de la commande");
        }
        const update = await statusUpdate(prisma, current, data.status, { reason: data.reason, prepMinutes: data.prepMinutes });
        const order = await prisma.order.update({ where: { id }, data: update, include: listInclude });
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
        return order;
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
    return { order, plan, reason: parsed.data.reason, discount, total, refund, commission: Math.round((plan.subtotal * restaurant.commissionRate) / 100) };
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
      await prisma.$transaction([
        ...plan.updates.map((u) => (u.quantity === 0 ? prisma.orderItem.delete({ where: { id: u.id } }) : prisma.orderItem.update({ where: { id: u.id }, data: { quantity: u.quantity } }))),
        ...plan.additions.map((a) => prisma.orderItem.create({ data: { ...a, orderId: order.id } })),
        prisma.order.update({
          where: { id: order.id },
          data: { subtotal: plan.subtotal, discount: q.discount, total: q.total, commission: q.commission, refundDue: { increment: q.refund } },
        }),
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

  // --- Réglages et relevés ---

  router.patch(
    "/settings",
    write(
      settingsInput,
      async (data, _id, res) => {
        const min = data.deliveryTimeMin;
        const max = data.deliveryTimeMax;
        if (min !== undefined && max !== undefined && min > max) throw new HttpError(400, "Le délai minimum dépasse le maximum");
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
        where: { restaurantId: me(res), type: "FOOD", status: "DELIVERED", settlementId: null },
        select: { subtotal: true, commission: true },
      }),
    ]);
    const sales = pending.reduce((s, o) => s + o.subtotal, 0);
    const commission = pending.reduce((s, o) => s + o.commission, 0);
    const { subscriptionFee } = await prisma.restaurant.findUniqueOrThrow({ where: { id: me(res) }, select: { subscriptionFee: true } });
    res.json({ settlements, pending: { orders: pending.length, sales, commission, amountDue: sales - commission }, subscriptionFee });
  });

  return router;
}
