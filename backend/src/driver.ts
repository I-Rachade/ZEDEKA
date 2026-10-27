import type { OrderStatus, OrderType } from "@prisma/client";

// Règles de l'application livreur : délais, étapes qu'il peut valider, espèces, gains.

export const ASSIGNMENT_TIMEOUT_MS = 60_000; // délai pour accepter ou refuser une course
export const OFFLINE_AFTER_MS = 30 * 60_000; // hors ligne automatiquement sans signe de vie
export const LOCATION_EVERY_MS = 30_000;

// Le livreur récupère la commande (repas acceptée par le restaurant, colis dès la demande), puis la remet.
export function canDriverMove(type: OrderType, from: OrderStatus, to: OrderStatus): boolean {
  if (to === "PICKED_UP") return type === "PARCEL" ? ["PENDING", "CONFIRMED", "PREPARING", "READY"].includes(from) : ["CONFIRMED", "PREPARING", "READY"].includes(from);
  if (to === "DELIVERED") return from === "PICKED_UP";
  return false;
}

// Heure d'une étape validée hors connexion : celle de l'appareil si elle est plausible, sinon maintenant.
export function eventTime(at: string | undefined, now = new Date()): Date {
  if (!at) return now;
  const t = new Date(at);
  if (isNaN(+t) || t.getTime() > now.getTime() + 2 * 60_000 || t.getTime() < now.getTime() - 24 * 60 * 60_000) return now;
  return t > now ? now : t;
}

// Espèces à encaisser : le total, moins ce qui a déjà été payé en mobile money.
export function cashDue(order: { paymentMethod: "CASH" | "MOBILE_MONEY"; paymentStatus: "PAID" | "UNPAID"; total: number }): number {
  return order.paymentMethod === "CASH" && order.paymentStatus !== "PAID" ? order.total : 0;
}

// Montant reçu à la remise : un écart doit être expliqué.
export function checkCash(due: number, collected: number | undefined, note: string | undefined): string | null {
  if (due === 0) return null;
  if (collected === undefined) return "Indiquez le montant reçu en espèces";
  if (collected !== due && !note?.trim()) return "Le montant reçu diffère du total : indiquez pourquoi";
  return null;
}

type Delivered = { deliveredAt: Date | null; driverEarning: number };

const day = (d: Date) => d.toISOString().slice(0, 10); // Lomé est à UTC+0

export function earningsSummary(orders: Delivered[], now = new Date()) {
  const today = day(now);
  const weekStart = new Date(now.getTime() - 6 * 24 * 60 * 60_000);
  const monthStart = today.slice(0, 7);
  const sum = { today: 0, week: 0, month: 0, todayCount: 0, weekCount: 0, monthCount: 0 };
  const byDay = new Map<string, { amount: number; count: number }>();
  for (const o of orders) {
    if (!o.deliveredAt) continue;
    const d = day(o.deliveredAt);
    if (d === today) {
      sum.today += o.driverEarning;
      sum.todayCount++;
    }
    if (d >= day(weekStart)) {
      sum.week += o.driverEarning;
      sum.weekCount++;
    }
    if (d.startsWith(monthStart)) {
      sum.month += o.driverEarning;
      sum.monthCount++;
    }
    const entry = byDay.get(d) ?? { amount: 0, count: 0 };
    entry.amount += o.driverEarning;
    entry.count++;
    byDay.set(d, entry);
  }
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, v]) => ({ date, ...v }));
  return { ...sum, days };
}

export const ISSUE_KINDS = {
  RESTAURANT_CLOSED: "Restaurant fermé ou commande pas prête",
  CUSTOMER_UNREACHABLE: "Client injoignable",
  ADDRESS_NOT_FOUND: "Adresse introuvable",
  ACCIDENT: "Accident ou panne",
  PAYMENT: "Problème de paiement",
  OTHER: "Autre",
} as const;
