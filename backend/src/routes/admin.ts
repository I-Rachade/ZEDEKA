import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { checkPassword, issueToken, requireAdmin } from "../auth.js";
import { BREAK_EVEN_PER_DAY, buildReport, startOfDayUtc, zedekaRevenue } from "../stats.js";
import { adminCatalogRouter } from "./adminCatalog.js";
import { adminFinanceRouter } from "./adminFinance.js";
import { adminOrdersRouter } from "./adminOrders.js";

type AdminConfig = { adminPassword: string; adminSecret: string };

const STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP", "DELIVERED", "CANCELLED"] as const;

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

  router.get("/dashboard", async (_req, res) => {
    const today = startOfDayUtc(new Date());
    const [todayOrders, byStatus, recent, pendingDrivers] = await Promise.all([
      prisma.order.findMany({
        where: { createdAt: { gte: today }, status: { not: "CANCELLED" } },
        select: { deliveryFee: true, extraFee: true, discount: true, commission: true, driverEarning: true, total: true, type: true },
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
    ]);
    const revenue = todayOrders.reduce((sum, o) => sum + zedekaRevenue(o), 0);
    res.json({
      today: {
        orders: todayOrders.length,
        parcels: todayOrders.filter((o) => o.type === "PARCEL").length,
        revenue,
        orderValue: todayOrders.reduce((sum, o) => sum + o.total, 0),
        breakEven: BREAK_EVEN_PER_DAY,
      },
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((g) => g.status === s)?._count._all ?? 0])),
      recent,
      pendingDrivers,
    });
  });

  router.get("/report", async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 92);
    const from = new Date(startOfDayUtc(new Date()).getTime() - (days - 1) * 86_400_000);
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
      ),
    );
  });

  router.use(adminOrdersRouter(prisma));
  router.use(adminCatalogRouter(prisma));
  router.use(adminFinanceRouter(prisma));

  return router;
}
