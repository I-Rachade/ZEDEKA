import type { PrismaClient } from "@prisma/client";
import type { Notifier } from "./notify.js";
import { formatFcfa } from "./pricing.js";
import { autoOffline, expireAssignments } from "./routes/driverApp.js";

// Commandes et réservations restées sans réponse : l'admin est prévenu (push) et le partenaire relancé par SMS.
export const RESTAURANT_ALERT_MS = 3 * 60_000;
export const RENTAL_ALERT_MS = 10 * 60_000;

export async function escalateUnanswered(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const orders = await prisma.order.findMany({
    where: { type: "FOOD", status: "PENDING", alertedAdminAt: null, createdAt: { lt: new Date(now.getTime() - RESTAURANT_ALERT_MS) } },
    select: { id: true, code: true, total: true, restaurant: { select: { name: true, phone: true } } },
  });
  for (const o of orders) {
    // Marquée d'abord : une seule alerte même si deux boucles tournent en même temps.
    const { count } = await prisma.order.updateMany({ where: { id: o.id, alertedAdminAt: null }, data: { alertedAdminAt: now } });
    if (!count) continue;
    await notifier.push("admin", "admin", {
      title: `Sans réponse : ${o.code}`,
      body: `${o.restaurant?.name ?? "Restaurant"} n'a pas accepté depuis 3 min · ${formatFcfa(o.total)}`,
      url: `/admin/commandes/${o.id}`,
      tag: `late-${o.id}`,
      alarm: true,
    });
    if (o.restaurant) await notifier.sms(o.restaurant.phone, `Zedeka : la commande ${o.code} attend votre réponse depuis 3 minutes. Ouvrez votre espace restaurant.`);
  }

  const trips = await prisma.trip.findMany({
    where: { status: "PENDING", alertedAdminAt: null, createdAt: { lt: new Date(now.getTime() - RENTAL_ALERT_MS) } },
    select: { id: true, code: true, total: true, provider: { select: { name: true, phone: true } } },
  });
  for (const t of trips) {
    const { count } = await prisma.trip.updateMany({ where: { id: t.id, alertedAdminAt: null }, data: { alertedAdminAt: now } });
    if (!count) continue;
    await notifier.push("admin", "admin", {
      title: `Sans réponse : ${t.code}`,
      body: `${t.provider.name} n'a pas confirmé depuis 10 min · ${formatFcfa(t.total)}`,
      url: `/admin/location`,
      tag: `late-${t.id}`,
      alarm: true,
    });
    await notifier.sms(t.provider.phone, `Zedeka : la réservation ${t.code} attend votre confirmation depuis 10 minutes.`);
  }
  return { orders: orders.length, trips: trips.length };
}

export function startAlertLoop(prisma: PrismaClient, notifier: Notifier, everyMs = 30_000) {
  const timer = setInterval(() => {
    escalateUnanswered(prisma, notifier).catch((e) => console.error("alertes", e));
    expireAssignments(prisma, notifier).catch((e) => console.error("affectations", e));
    autoOffline(prisma).catch((e) => console.error("hors ligne", e));
  }, everyMs);
  timer.unref();
  return timer;
}
