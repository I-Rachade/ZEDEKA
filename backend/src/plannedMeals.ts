import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { foodDeliveryFee, foodDistanceKm, zoneForPoint } from "./delivery.js";
import type { Notifier } from "./notify.js";
import { availability } from "./openingHours.js";
import { formatFcfa, priceOrder, type CartLine } from "./pricing.js";
import { OutOfStock, takeStock } from "./stock.js";
import { createOrderWithCode, getSettings } from "./util.js";

// Repas planifiés : le client commande à l'avance pour une heure donnée (ONCE, jusqu'à 7 jours), ou prend une
// formule cantine (WEEKLY : jours de la semaine et heure fixes, sur 1 à 4 semaines). Rien n'est envoyé au restaurant
// avant l'heure : 60 min avant chaque livraison, la tâche de chaque minute crée la vraie commande avec les prix du
// moment (mêmes règles que POST /orders, sans code promo), et le restaurant la reçoit comme une commande normale,
// avec « Repas planifié pour 12:30 » dans la note. Paiement en espèces à la livraison (mobile money à venir).
// Restaurant fermé ou plat épuisé à ce moment : la livraison du jour est sautée et le client prévenu.
// Heures en UTC, qui est l'heure de Lomé.

export const LEAD_MS = 60 * 60_000; // commande créée 60 min avant l'heure de livraison
export const MIN_NOTICE_MS = 90 * 60_000; // un repas planifié se prévoit au moins 1 h 30 à l'avance
export const MAX_AHEAD_DAYS = 7;
export const MAX_WEEKS = 4;
const HOUR = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const plannedInput = z
  .object({
    restaurantSlug: z.string().min(1),
    kind: z.enum(["ONCE", "WEEKLY"]).default("ONCE"),
    deliverAt: z.string().datetime({ offset: true }).optional(),
    time: z.string().regex(HOUR, "Heure invalide (ex. 12:30)").optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    weeks: z.number().int().min(1).max(MAX_WEEKS).default(1),
    customerName: z.string().trim().min(2).max(80),
    customerPhone: z.string().trim().regex(/^\+?[0-9 ]{8,15}$/, "Numéro de téléphone invalide"),
    address: z.string().trim().max(300).default(""),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    note: z.string().trim().max(300).optional(),
    items: z
      .array(
        z.object({
          menuItemId: z.string().min(1),
          quantity: z.number().int().min(1).max(50),
          variantId: z.string().optional(),
          addonIds: z.array(z.string()).max(20).optional(),
          choices: z.array(z.string().max(60)).max(10).optional(),
        }),
      )
      .min(1, "Le panier est vide")
      .max(50, "Panier trop grand"),
  })
  .refine((p) => (p.kind === "ONCE" ? !!p.deliverAt : !!p.time && !!p.days?.length), { message: "Choisissez le jour et l'heure de livraison" });
export type PlannedInput = z.infer<typeof plannedInput>;

export const hhmmOf = (d: Date) => d.toISOString().slice(11, 16);
const atTime = (day: Date, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));
};
export const parseDays = (raw: string | null | undefined) =>
  (raw ?? "")
    .split(",")
    .filter((d) => d.trim() !== "")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

type Schedule = { kind: string; deliverAt: Date | null; deliverTime: string; days: string | null; endsAt: Date | null };

// Prochaine livraison strictement après `after` (null : plus rien de prévu).
export function nextDelivery(plan: Schedule, after: Date): Date | null {
  if (plan.kind !== "WEEKLY") return plan.deliverAt && plan.deliverAt > after ? plan.deliverAt : null;
  const days = parseDays(plan.days);
  if (!days.length) return null;
  for (let i = 0; i <= 7; i++) {
    const day = new Date(after.getTime() + i * 86_400_000);
    if (!days.includes(day.getUTCDay())) continue;
    const at = atTime(day, plan.deliverTime);
    if (at <= after) continue;
    return plan.endsAt && at > plan.endsAt ? null : at;
  }
  return null;
}

// Heure choisie par le client : assez tôt pour le restaurant, pas plus de 7 jours à l'avance.
export function scheduleError(kind: "ONCE" | "WEEKLY", first: Date | null, now: Date): string | null {
  if (!first) return "Aucune livraison possible avec ces jours et cette heure";
  if (first.getTime() - now.getTime() < MIN_NOTICE_MS) return kind === "ONCE" ? "Planifiez au moins 1 h 30 à l'avance" : null;
  if (kind === "ONCE" && first.getTime() - now.getTime() > MAX_AHEAD_DAYS * 86_400_000) return "Planifiez au plus 7 jours à l'avance";
  return null;
}

const restaurantSelect = {
  id: true,
  name: true,
  slug: true,
  zoneId: true,
  latitude: true,
  longitude: true,
  active: true,
  deletedAt: true,
  temporarilyClosed: true,
  closedUntil: true,
  openingHours: true,
  minOrderAmount: true,
  commissionRate: true,
  kind: true,
} as const;

const itemSelect = {
  id: true,
  name: true,
  price: true,
  variants: { select: { id: true, name: true, price: true } },
  addons: { where: { available: true }, select: { id: true, name: true, price: true } },
  options: true,
  stock: true,
} as const;

// Prix du panier livré à ce point (mêmes règles que POST /orders) : erreur lisible si un plat n'existe plus.
export async function quotePlanned(
  prisma: PrismaClient,
  restaurant: { id: string; zoneId: string | null; latitude: number | null; longitude: number | null; minOrderAmount: number },
  drop: { latitude: number; longitude: number },
  items: CartLine[],
) {
  const [settings, zoneId, menuItems] = await Promise.all([
    getSettings(prisma),
    zoneForPoint(prisma, drop),
    prisma.menuItem.findMany({ where: { restaurantId: restaurant.id, available: true, id: { in: items.map((i) => i.menuItemId) } }, select: itemSelect }),
  ]);
  if (!zoneId) throw new PlanError("Ce point de livraison est hors de nos zones");
  const zones = await prisma.zone.findMany({ where: { id: { in: [zoneId, restaurant.zoneId].filter((x): x is string => !!x) } } });
  const zone = zones.find((z) => z.id === zoneId);
  if (!zone || !zone.active) throw new PlanError("Ce point de livraison est hors de nos zones");
  const km = foodDistanceKm({ point: drop }, { point: restaurant, zone: zones.find((z) => z.id === restaurant.zoneId) });
  const fee = foodDeliveryFee(settings, km, zone);
  let priced;
  try {
    priced = priceOrder(items, menuItems, fee);
  } catch (e) {
    throw new PlanError((e as Error).message);
  }
  if (priced.subtotal < restaurant.minOrderAmount) throw new PlanError(`Commande minimum : ${formatFcfa(restaurant.minOrderAmount)} (hors livraison)`);
  return { priced, zone, km, menuItems };
}

export class PlanError extends Error {}

type Plan = {
  id: string;
  customerId: string;
  restaurantId: string;
  items: string;
  customerName: string;
  customerPhone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  paymentMethod: string;
  kind: string;
};

// Crée la commande d'une livraison planifiée. Renvoie la commande, ou lève PlanError (message pour le client).
export async function placePlannedOrder(prisma: PrismaClient, notifier: Notifier, plan: Plan, deliverAt: Date, now = new Date()) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: plan.restaurantId }, select: restaurantSelect });
  if (!restaurant || restaurant.deletedAt) throw new PlanError("Ce restaurant n'est plus sur Zedeka");
  const open = availability(restaurant, now);
  if (!open.open) throw new PlanError(open.reason ?? "Le restaurant est fermé");
  if (plan.latitude === null || plan.longitude === null) throw new PlanError("Point de livraison manquant");
  const drop = { latitude: plan.latitude, longitude: plan.longitude };
  const items = JSON.parse(plan.items) as CartLine[];
  const { priced, zone, km, menuItems } = await quotePlanned(prisma, restaurant, drop, items);
  let restore: () => Promise<void>;
  try {
    restore = await takeStock(prisma, priced.lines, menuItems);
  } catch (e) {
    if (e instanceof OutOfStock) throw new PlanError(e.message);
    throw e;
  }
  const label = `${plan.kind === "WEEKLY" ? "Formule cantine" : "Repas planifié"} pour ${hhmmOf(deliverAt)}`;
  const order = await createOrderWithCode(prisma, {
    type: "FOOD",
    customerId: plan.customerId,
    fulfillment: "DELIVERY",
    restaurantId: restaurant.id,
    zoneId: zone.id,
    customerName: plan.customerName,
    customerPhone: plan.customerPhone,
    termsAcceptedAt: now,
    address: plan.address || "Position sur la carte",
    latitude: drop.latitude,
    longitude: drop.longitude,
    locationSource: "SENDER",
    distanceKm: km,
    note: [`🕒 ${label}`, plan.note].filter(Boolean).join(" · "),
    paymentMethod: "CASH",
    subtotal: priced.subtotal,
    deliveryFee: priced.deliveryFee,
    total: priced.total,
    commission: Math.round((priced.subtotal * restaurant.commissionRate) / 100),
    items: { create: priced.lines },
  }).catch(async (e) => {
    await restore();
    throw e;
  });
  void notifier.push("restaurant", restaurant.id, {
    title: `Nouvelle commande ${order.code}`,
    body: `${formatFcfa(order.subtotal)} · ${label}`,
    url: `/restaurant/commandes/${order.id}`,
    tag: `order-${order.id}`,
    alarm: true,
  });
  void notifier.staff("ORDERS", { title: `Commande ${order.code} (${label.toLowerCase()})`, body: `${restaurant.name} · ${formatFcfa(order.total)}`, url: `/admin/commandes/${order.id}`, tag: `order-${order.id}` });
  void notifier.push("customer", plan.customerId, {
    title: `${label} : commande ${order.code} envoyée`,
    body: `${restaurant.name} prépare votre repas. Total ${formatFcfa(order.total)}, à payer à la livraison.`,
    url: `/commande/${order.code}`,
    tag: `order-${order.id}`,
  });
  return order;
}

// Tâche de chaque minute : crée les commandes des livraisons qui arrivent dans l'heure.
export async function runPlannedMeals(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const due = await prisma.plannedMeal.findMany({ where: { status: "ACTIVE", nextRunAt: { lte: new Date(now.getTime() + LEAD_MS) } }, take: 50 });
  for (const plan of due) {
    const deliverAt = plan.nextRunAt!;
    const next = nextDelivery(plan, deliverAt);
    // Une seule commande par livraison prévue, même si deux tâches se croisent.
    const claimed = await prisma.plannedMealRun.create({ data: { plannedMealId: plan.id, deliverAt } }).catch(() => null);
    const advance = () =>
      prisma.plannedMeal.update({ where: { id: plan.id }, data: { nextRunAt: next, status: next ? plan.status : "DONE" } });
    if (!claimed) {
      await advance();
      continue;
    }
    let error: string | null = null;
    if (deliverAt.getTime() - now.getTime() < 20 * 60_000) error = "Livraison sautée : trop tard pour préparer le repas";
    else {
      const customer = await prisma.customer.findUnique({ where: { id: plan.customerId }, select: { deletedAt: true } });
      if (!customer || customer.deletedAt) {
        await prisma.plannedMeal.update({ where: { id: plan.id }, data: { status: "CANCELLED", nextRunAt: null } });
        continue;
      }
      try {
        const order = await placePlannedOrder(prisma, notifier, plan, deliverAt, now);
        await prisma.plannedMealRun.update({ where: { id: claimed.id }, data: { orderId: order.id, orderCode: order.code } });
      } catch (e) {
        if (!(e instanceof PlanError)) console.error("repas planifié", plan.id, e);
        error = e instanceof PlanError ? e.message : "Commande impossible pour le moment";
      }
    }
    if (error) {
      await prisma.plannedMealRun.update({ where: { id: claimed.id }, data: { error } });
      void notifier.push("customer", plan.customerId, {
        title: `Repas de ${hhmmOf(deliverAt)} non commandé`,
        body: `${error}.${next ? " Les prochaines livraisons restent prévues." : ""}`,
        url: "/app/repas-planifies",
        tag: `plan-${plan.id}`,
      });
    }
    await prisma.plannedMeal.update({ where: { id: plan.id }, data: { nextRunAt: next, status: next ? plan.status : "DONE", lastError: error } });
  }
}
