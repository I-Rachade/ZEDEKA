import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { OPEN } from "../orderFlow.js";
import { startOfDayUtc } from "../stats.js";

// Au-delà, l'application livreur est considérée sans signal (réseau coupé, téléphone éteint).
export const NO_SIGNAL_MS = 5 * 60_000;
// Commande encore ouverte longtemps après sa création : à regarder.
export const LATE_MS = 90 * 60_000;

// Santé de la plateforme (back-office, directeur et adjoint) : la base répond-elle et en combien de temps,
// l'activité du jour, la dernière activité de chaque appli, et ce qui cloche sur le terrain.
export function adminHealthRouter(prisma: PrismaClient) {
  const router = Router();
  router.get("/health", async (_req, res) => {
    const now = new Date();
    const since = startOfDayUtc(now);
    const stale = new Date(now.getTime() - NO_SIGNAL_MS);
    const late = new Date(now.getTime() - LATE_MS);
    const DRIVER_ON_DUTY = { active: true, status: "APPROVED", deletedAt: null } as const;
    const noSignal = { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: stale } }] };

    // Première lecture chronométrée : temps de réponse de la base vu du serveur.
    const t0 = Date.now();
    const ordersToday = await prisma.order.count({ where: { type: "FOOD", createdAt: { gte: since } } });
    const dbMs = Date.now() - t0;

    const [
      parcelsToday,
      ridesToday,
      lastOrder,
      lastParcel,
      lastRide,
      lastDriver,
      lastCustomer,
      lastRestaurant,
      lastStaff,
      driversOnline,
      driversOnlineNoSignal,
      driversBusyNoSignal,
      ordersLate,
      pushDevices,
      alerts24h,
    ] = await Promise.all([
      prisma.order.count({ where: { type: "PARCEL", createdAt: { gte: since } } }),
      prisma.zedRide.count({ where: { createdAt: { gte: since } } }),
      prisma.order.findFirst({ where: { type: "FOOD" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.order.findFirst({ where: { type: "PARCEL" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.zedRide.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.driver.findFirst({ where: { lastSeenAt: { not: null } }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
      prisma.customer.findFirst({ where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: "desc" }, select: { lastLoginAt: true } }),
      prisma.restaurantStaff.findFirst({ where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: "desc" }, select: { lastLoginAt: true } }),
      prisma.teamMember.findFirst({ where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: "desc" }, select: { lastLoginAt: true } }),
      prisma.driver.count({ where: { ...DRIVER_ON_DUTY, online: true, lastSeenAt: { gte: stale } } }),
      // Marqués « en ligne » mais l'application ne donne plus signe de vie.
      prisma.driver.count({ where: { ...DRIVER_ON_DUTY, online: true, ...noSignal } }),
      // En course et sans signal : le client ne voit plus le livreur bouger.
      prisma.driver.count({ where: { ...DRIVER_ON_DUTY, orders: { some: { status: { in: OPEN } } }, ...noSignal } }),
      prisma.order.count({ where: { status: { in: OPEN }, createdAt: { lt: late } } }),
      prisma.pushSubscription.count(),
      prisma.staffNotification.count({ where: { createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } }),
    ]);

    res.json({
      checkedAt: now.toISOString(),
      db: { ok: true, ms: dbMs },
      today: { orders: ordersToday, parcels: parcelsToday, rides: ridesToday },
      last: {
        order: lastOrder?.createdAt ?? null,
        parcel: lastParcel?.createdAt ?? null,
        ride: lastRide?.createdAt ?? null,
        driver: lastDriver?.lastSeenAt ?? null,
        customer: lastCustomer?.lastLoginAt ?? null,
        restaurant: lastRestaurant?.lastLoginAt ?? null,
        staff: lastStaff?.lastLoginAt ?? null,
      },
      field: { driversOnline, driversOnlineNoSignal, driversBusyNoSignal, ordersLate, pushDevices, alerts24h },
    });
  });
  return router;
}
