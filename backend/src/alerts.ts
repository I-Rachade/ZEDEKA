import type { PrismaClient } from "@prisma/client";
import type { Notifier } from "./notify.js";
import { formatFcfa } from "./pricing.js";

// Commandes restées sans réponse : l'admin est prévenu (push) et le partenaire relancé par SMS.
export const RESTAURANT_ALERT_MS = 3 * 60_000;

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

  return { orders: orders.length };
}
