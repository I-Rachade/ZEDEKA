import type { Order, PrismaClient } from "@prisma/client";
import type { Notifier } from "./notify.js";
import { formatFcfa } from "./pricing.js";
import { getSettings } from "./util.js";

// Dépôt de Zedeka chez un restaurant (décision du 1er novembre 2026) : Zedeka laisse une somme (25 000 FCFA par
// défaut) ; à chaque repas livré et payé à Zedeka (espèces du livreur ou mobile money), le restaurant se paie le prix
// des plats sur cette somme au lieu d'attendre un relevé. Quand le solde baisse, Zedeka recharge.
// Un retrait payé au comptoir n'y touche pas : le restaurant a encaissé lui-même.

// Ce que la commande coûte au dépôt : les plats, moins la commission (0 pour les restaurants à l'abonnement).
export const depositCost = (o: { subtotal: number; commission: number }) => o.subtotal - o.commission;

// La commande livrée se règle-t-elle sur le dépôt ? Seulement pour un repas payé à Zedeka, chez un restaurant
// qui a un dépôt.
export function settlesOnDeposit(o: Pick<Order, "type" | "fulfillment" | "paymentMethod" | "restaurantId">, hasDeposit: boolean): boolean {
  if (o.type !== "FOOD" || !o.restaurantId || !hasDeposit) return false;
  return !(o.fulfillment === "PICKUP" && o.paymentMethod === "CASH");
}

export async function hasDeposit(prisma: PrismaClient, restaurantId: string): Promise<boolean> {
  return (await prisma.restaurantDeposit.count({ where: { restaurantId } })) > 0;
}

export type DepositBalance = { active: boolean; deposited: number; consumed: number; balance: number };

export function balanceOf(deposits: { amount: number }[], consumedOrders: { subtotal: number; commission: number }[]): DepositBalance {
  const deposited = deposits.reduce((s, d) => s + d.amount, 0);
  const consumed = consumedOrders.reduce((s, o) => s + depositCost(o), 0);
  return { active: deposits.length > 0, deposited, consumed, balance: deposited - consumed };
}

const CONSUMED = { type: "FOOD", status: "DELIVERED", paidFromDeposit: true } as const;

export async function depositBalance(prisma: PrismaClient, restaurantId: string): Promise<DepositBalance> {
  const [deposits, orders] = await Promise.all([
    prisma.restaurantDeposit.findMany({ where: { restaurantId }, select: { amount: true } }),
    prisma.order.findMany({ where: { restaurantId, ...CONSUMED }, select: { subtotal: true, commission: true } }),
  ]);
  return balanceOf(deposits, orders);
}

// Soldes de tous les restaurants (écran Finances).
export async function depositBalances(prisma: PrismaClient): Promise<Map<string, DepositBalance & { lastDepositAt: Date | null }>> {
  const [deposits, orders] = await Promise.all([
    prisma.restaurantDeposit.findMany({ select: { restaurantId: true, amount: true, createdAt: true } }),
    prisma.order.findMany({ where: CONSUMED, select: { restaurantId: true, subtotal: true, commission: true } }),
  ]);
  const ids = new Set(deposits.map((d) => d.restaurantId));
  const out = new Map<string, DepositBalance & { lastDepositAt: Date | null }>();
  for (const id of ids) {
    const mine = deposits.filter((d) => d.restaurantId === id);
    out.set(id, {
      ...balanceOf(
        mine,
        orders.filter((o) => o.restaurantId === id),
      ),
      lastDepositAt: mine.reduce<Date | null>((last, d) => (!last || d.createdAt > last ? d.createdAt : last), null),
    });
  }
  return out;
}

// Mouvements récents du dépôt : recharges (+) et commandes réglées dessus (−), les plus récents d'abord.
export async function depositMovements(prisma: PrismaClient, restaurantId: string, take = 30) {
  const [deposits, orders] = await Promise.all([
    prisma.restaurantDeposit.findMany({ where: { restaurantId }, orderBy: { createdAt: "desc" }, take }),
    prisma.order.findMany({
      where: { restaurantId, ...CONSUMED },
      orderBy: { deliveredAt: "desc" },
      take,
      select: { id: true, code: true, subtotal: true, commission: true, deliveredAt: true },
    }),
  ]);
  return [
    ...deposits.map((d) => ({ kind: "DEPOSIT" as const, id: d.id, at: d.createdAt, amount: d.amount, note: d.note, code: null })),
    ...orders.map((o) => ({ kind: "ORDER" as const, id: o.id, at: o.deliveredAt ?? new Date(0), amount: -depositCost(o), note: null, code: o.code })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, take);
}

// Après une livraison réglée sur le dépôt : alerte l'équipe (finances) et le restaurant si le solde passe sous le seuil.
export async function alertLowDeposit(prisma: PrismaClient, notifier: Notifier, restaurantId: string) {
  const [{ balance, active }, settings, restaurant] = await Promise.all([
    depositBalance(prisma, restaurantId),
    getSettings(prisma),
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } }),
  ]);
  if (!active || balance >= settings.depositLowThreshold) return;
  const body = `Solde ${formatFcfa(balance)} (seuil ${formatFcfa(settings.depositLowThreshold)}) : à recharger.`;
  await Promise.all([
    notifier.staff("FINANCE", { title: `Dépôt bas : ${restaurant?.name ?? "restaurant"}`, body, url: "/admin/finances", tag: `deposit-${restaurantId}` }),
    notifier.push("restaurant", restaurantId, { title: "Dépôt Zedeka bas", body, url: "/restaurant/releves", tag: `deposit-${restaurantId}` }),
  ]);
}
