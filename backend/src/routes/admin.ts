import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { checkPassword, issueToken, requireAdmin } from "../auth.js";
import { OPEN, STATUSES } from "../orderFlow.js";
import { BREAK_EVEN_PER_DAY, buildReport, startOfDayUtc, subscriptionsPerDay, zedekaRevenue } from "../stats.js";
import { adminCatalogRouter } from "./adminCatalog.js";
import { adminFinanceRouter } from "./adminFinance.js";
import { adminOrdersRouter } from "./adminOrders.js";
import { adminRentalRouter } from "./adminRental.js";
import { adminVendorsRouter } from "./adminVendors.js";
import type { Notifier } from "../notify.js";
import { pushRoutes } from "./partnerAccount.js";

type AdminConfig = { adminPassword: string; adminSecret: string; uploadDir: string; notifier: Notifier };


export function adminRouter(prisma: PrismaClient, config: AdminConfig) {
  const router = Router();

  router.post("/login", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!checkPassword(password, config.adminPassword)) {
      res.status(401).json({ error: "Mot de passe incorrect" });
      return;
    }
    res.json({ token: issueToken(config.adminSecret) });
  });

  router.use(requireAdmin(config.adminSecret));
  pushRoutes(router, prisma, config.notifier, "admin", () => "admin", "/admin/repartition");

  // Compteurs du menu latéral.
  router.get("/nav", async (_req, res) => {
    const [newOrders, toDispatch, pendingDrivers, cashOrders, pendingVendors] = await Promise.all([
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.order.count({
        where: {
          status: { in: OPEN },
          driverId: null,
          fulfillment: "DELIVERY",
          OR: [{ type: "PARCEL" }, { status: { in: ["READY", "PICKED_UP"] } }],
        },
      }),
      prisma.driver.count({ where: { status: "PENDING" } }),
      prisma.order.count({ where: { status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null, driverId: { not: null } } }),
      prisma.vendorApplication.count({ where: { status: "PENDING" } }),
    ]);
    res.json({ newOrders, toDispatch, pendingDrivers, cashOrders, pendingVendors });
  });

  router.get("/dashboard", async (_req, res) => {
    const today = startOfDayUtc(new Date());
    const [todayOrders, byStatus, recent, pendingDrivers, subscribed] = await Promise.all([
      prisma.order.findMany({
        where: { createdAt: { gte: today }, status: { not: "CANCELLED" } },
        select: { deliveryFee: true, extraFee: true, discount: true, commission: true, driverEarning: true, total: true, type: true, createdAt: true, deliveredAt: true, zone: { select: { name: true } } },
      }),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: { gte: today } } }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          code: true,
          type: true,
          status: true,
          total: true,
          createdAt: true,
          restaurant: { select: { name: true } },
          driver: { select: { name: true } },
        },
      }),
      prisma.driver.count({ where: { status: "PENDING" } }),
      prisma.restaurant.findMany({ where: { active: true, subscriptionFee: { not: null } }, select: { subscriptionFee: true } }),
    ]);
    const subscriptions = subscriptionsPerDay(subscribed);
    const revenue = todayOrders.reduce((sum, o) => sum + zedekaRevenue(o), 0) + subscriptions;
    // Pour les graphiques du tableau de bord : commandes par heure (Lomé = UTC), par zone, délai moyen des livrées.
    const byHour = Array.from({ length: 24 }, (_, h) => todayOrders.filter((o) => o.createdAt.getUTCHours() === h).length);
    const zoneCounts = new Map<string, number>();
    for (const o of todayOrders) zoneCounts.set(o.zone.name, (zoneCounts.get(o.zone.name) ?? 0) + 1);
    const byZone = [...zoneCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const delivered = todayOrders.filter((o) => o.deliveredAt);
    const avgDeliveryMinutes = delivered.length
      ? Math.round(delivered.reduce((sum, o) => sum + (o.deliveredAt!.getTime() - o.createdAt.getTime()), 0) / delivered.length / 60_000)
      : null;
    res.json({
      today: {
        orders: todayOrders.length,
        parcels: todayOrders.filter((o) => o.type === "PARCEL").length,
        revenue,
        orderValue: todayOrders.reduce((sum, o) => sum + o.total, 0),
        breakEven: BREAK_EVEN_PER_DAY,
        subscriptions,
        subscribedRestaurants: subscribed.length,
        avgDeliveryMinutes,
      },
      byHour,
      byZone,
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((g) => g.status === s)?._count._all ?? 0])),
      recent,
      pendingDrivers,
    });
  });

  router.get("/report", async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 92);
    const from = new Date(startOfDayUtc(new Date()).getTime() - (days - 1) * 86_400_000);
    const subscribed = await prisma.restaurant.findMany({ where: { active: true, subscriptionFee: { not: null } }, select: { subscriptionFee: true } });
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: from } },
      select: {
        type: true,
        status: true,
        deliveryFee: true,
        extraFee: true,
        discount: true,
        commission: true,
        driverEarning: true,
        createdAt: true,
        deliveredAt: true,
        restaurant: { select: { name: true } },
      },
    });
    res.json(
      buildReport(
        orders.map((o) => ({ ...o, restaurantName: o.restaurant?.name ?? (o.type === "PARCEL" ? "Colis" : "—") })),
        from,
        days,
        subscriptionsPerDay(subscribed),
      ),
    );
  });

  router.use(adminOrdersRouter(prisma, config.notifier));
  router.use(adminCatalogRouter(prisma));
  router.use(adminFinanceRouter(prisma));
  router.use(adminRentalRouter(prisma));
  router.use(adminVendorsRouter(prisma, { uploadDir: config.uploadDir }));

  return router;
}
