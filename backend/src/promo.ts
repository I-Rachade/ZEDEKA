import type { PrismaClient } from "@prisma/client";
import { formatFcfa } from "./pricing.js";

// Codes promo : calcul de la remise, toujours par le serveur (le client n'affiche qu'un aperçu).

export const PROMO_KINDS = ["PERCENT", "AMOUNT", "FREE_DELIVERY"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export type PromoRule = {
  code: string;
  kind: string;
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  restaurantId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  perCustomer: number;
  active: boolean;
};

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

// Texte court d'une offre : « -20 %, plafond 2 000 FCFA », « -1 000 FCFA », « Livraison offerte ».
export function promoLabel(p: Pick<PromoRule, "kind" | "value" | "maxDiscount" | "minSubtotal">): string {
  const main =
    p.kind === "PERCENT"
      ? `-${p.value} %${p.maxDiscount ? `, plafond ${formatFcfa(p.maxDiscount)}` : ""}`
      : p.kind === "AMOUNT"
        ? `-${formatFcfa(p.value)}`
        : "Livraison offerte";
  return p.minSubtotal > 0 ? `${main}, dès ${formatFcfa(p.minSubtotal)}` : main;
}

// Remise d'un code pour une commande, ou la raison du refus (message montré au client tel quel).
export function promoDiscount(
  p: PromoRule,
  o: { subtotal: number; deliveryFee: number; restaurantId: string; uses: number; customerUses: number },
  now = new Date(),
): { discount: number } | { error: string } {
  if (!p.active || (p.startsAt && p.startsAt > now)) return { error: "Ce code n'est pas actif" };
  if (p.endsAt && p.endsAt <= now) return { error: "Ce code a expiré" };
  if (p.restaurantId && p.restaurantId !== o.restaurantId) return { error: "Ce code ne vaut pas pour ce restaurant" };
  if (p.maxUses !== null && o.uses >= p.maxUses) return { error: "Ce code a déjà été utilisé le nombre de fois prévu" };
  if (p.perCustomer > 0 && o.customerUses >= p.perCustomer) return { error: "Vous avez déjà utilisé ce code" };
  if (o.subtotal < p.minSubtotal) return { error: `Ce code vaut dès ${formatFcfa(p.minSubtotal)} de commande` };
  const raw =
    p.kind === "PERCENT"
      ? Math.round((o.subtotal * p.value) / 100)
      : p.kind === "AMOUNT"
        ? p.value
        : o.deliveryFee;
  const capped = p.kind === "PERCENT" && p.maxDiscount ? Math.min(raw, p.maxDiscount) : raw;
  // Jamais plus que ce que le client paierait.
  const discount = Math.max(0, Math.min(capped, o.subtotal + o.deliveryFee));
  if (discount === 0) return { error: p.kind === "FREE_DELIVERY" ? "La livraison est déjà offerte" : "Ce code ne donne pas de remise ici" };
  return { discount };
}

// Commandes non annulées qui ont utilisé ce code : en tout, et par ce client (compte, sinon numéro).
const LIVE = { status: { not: "CANCELLED" } } as const;
export async function promoUses(prisma: PrismaClient, promoId: string, who: { customerId: string | null; phone: string }) {
  const mine = who.customerId ? { customerId: who.customerId } : who.phone ? { customerPhone: who.phone } : null;
  const [uses, customerUses] = await Promise.all([
    prisma.order.count({ where: { promoId, ...LIVE } }),
    mine ? prisma.order.count({ where: { promoId, ...LIVE, ...mine } }) : Promise.resolve(0),
  ]);
  return { uses, customerUses };
}

// Offre visible maintenant (accueil, page restaurant).
export const livePromoWhere = (now: Date) => ({
  active: true,
  AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
});
