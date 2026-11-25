import type { PrismaClient } from "@prisma/client";
import { referralSummary } from "./offers.js";

// Zedeka+ (abonnement des clients), fidélité (points des clients, défis des livreurs) et mises en avant payées des
// commerces. Paiements encaissés à la main par l'équipe (mobile money ou espèces), comme les autres abonnements.

const DAY_MS = 24 * 60 * 60 * 1000;

// --- Zedeka+ ---

// Un mois d'abonnement : 30 jours.
export const PLUS_MONTH_DAYS = 30;

type PlusRules = { plusEnabled: boolean; plusDeliveryDiscount: number; plusMinSubtotal: number };

export const plusActive = (until: Date | null | undefined, now = new Date()): boolean => !!until && until.getTime() > now.getTime();

// Remise Zedeka+ sur la livraison d'un repas : un pourcentage des frais (100 : offerte), dès le panier minimum.
export function plusDiscount(deliveryFee: number, subtotal: number, s: PlusRules): number {
  if (!s.plusEnabled || deliveryFee <= 0 || subtotal < s.plusMinSubtotal) return 0;
  const pct = Math.max(0, Math.min(100, s.plusDeliveryDiscount));
  return Math.min(deliveryFee, Math.round((deliveryFee * pct) / 100));
}

// Paiement de `months` mois : l'abonnement repart de sa fin s'il court encore, sinon d'aujourd'hui.
export function extendPlus(until: Date | null, months: number, now = new Date()): { startsAt: Date; endsAt: Date } {
  const startsAt = plusActive(until, now) ? (until as Date) : now;
  return { startsAt, endsAt: new Date(startsAt.getTime() + months * PLUS_MONTH_DAYS * DAY_MS) };
}

// État de Zedeka+ pour un client (profil, caisse, page Zedeka+).
export function plusState(c: { plusUntil: Date | null; plusRequestedAt: Date | null }, s: PlusRules & { plusMonthlyFee: number }, now = new Date()) {
  return {
    enabled: s.plusEnabled,
    active: plusActive(c.plusUntil, now),
    until: c.plusUntil,
    requestedAt: c.plusRequestedAt,
    monthlyFee: s.plusMonthlyFee,
    deliveryDiscount: s.plusDeliveryDiscount,
    minSubtotal: s.plusMinSubtotal,
  };
}

// --- Points de fidélité des clients ---

// Les points comptent à partir du lancement du programme : les commandes plus anciennes n'en donnent pas.
export const LOYALTY_START = new Date("2026-11-23T00:00:00Z");

type LoyaltyRules = { loyaltySpendPerPoint: number; loyaltyRewardPoints: number };

export const pointsFor = (amount: number, spendPerPoint: number): number => (spendPerPoint > 0 && amount > 0 ? Math.floor(amount / spendPerPoint) : 0);

// Solde : points gagnés sur le montant des commandes livrées (repas, colis, boutiques, depuis le lancement), moins les
// points dépensés sur une commande non annulée (une commande annulée rend ses points).
export function loyaltyBalance(spent: number, redeemed: number, s: LoyaltyRules) {
  const earned = pointsFor(spent, s.loyaltySpendPerPoint);
  const points = Math.max(0, earned - redeemed);
  const rewardPoints = s.loyaltyRewardPoints;
  const rewards = rewardPoints > 0 && s.loyaltySpendPerPoint > 0 ? Math.floor(points / rewardPoints) : 0;
  return { earned, redeemed, points, rewardPoints, rewards, toNext: rewardPoints > 0 ? rewardPoints - (points % rewardPoints) : 0, spendPerPoint: s.loyaltySpendPerPoint };
}

export async function loyaltySummary(prisma: PrismaClient, customerId: string, s: LoyaltyRules) {
  const [spent, redeemed] = await Promise.all([
    prisma.order.aggregate({ where: { customerId, status: "DELIVERED", createdAt: { gte: LOYALTY_START } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { customerId, status: { not: "CANCELLED" }, loyaltyRedeemed: { gt: 0 } }, _sum: { loyaltyRedeemed: true } }),
  ]);
  return loyaltyBalance(spent._sum.total ?? 0, redeemed._sum.loyaltyRedeemed ?? 0, s);
}

// Livraisons offertes disponibles à la caisse : celles du parrainage, puis celles payées en points.
export async function freeDeliveryCredits(prisma: PrismaClient, customerId: string, s: LoyaltyRules) {
  const [referral, loyalty] = await Promise.all([referralSummary(prisma, customerId), loyaltySummary(prisma, customerId, s)]);
  return { referral: referral.freeDeliveries, loyalty: loyalty.rewards, total: referral.freeDeliveries + loyalty.rewards, loyaltyCost: loyalty.rewardPoints };
}

// --- Défis des livreurs ---

export type ChallengeRow = { id: string; title: string; target: number; reward: number; startsAt: Date; endsAt: Date; active: boolean };

export const challengeLive = (c: Pick<ChallengeRow, "active" | "startsAt" | "endsAt">, now = new Date()) =>
  c.active && c.startsAt.getTime() <= now.getTime() && c.endsAt.getTime() > now.getTime();

// Livraisons terminées par chaque livreur pendant la période du défi.
export async function challengeProgress(prisma: PrismaClient, c: Pick<ChallengeRow, "startsAt" | "endsAt">, driverId?: string) {
  const rows = await prisma.order.groupBy({
    by: ["driverId"],
    where: { status: "DELIVERED", driverId: driverId ?? { not: null }, deliveredAt: { gte: c.startsAt, lt: c.endsAt } },
    _count: { _all: true },
  });
  return new Map(rows.filter((r) => r.driverId).map((r) => [r.driverId as string, r._count._all]));
}

// Défis visibles dans l'appli livreur : en cours, et terminés depuis moins de 14 jours (prime à venir chercher).
export async function driverChallenges(prisma: PrismaClient, driverId: string, now = new Date()) {
  const challenges = await prisma.driverChallenge.findMany({
    where: { active: true, startsAt: { lte: now }, endsAt: { gt: new Date(now.getTime() - 14 * DAY_MS) } },
    orderBy: { endsAt: "asc" },
    include: { rewards: { where: { driverId }, select: { amount: true, paidAt: true } } },
  });
  return Promise.all(
    challenges.map(async (c) => {
      const done = (await challengeProgress(prisma, c, driverId)).get(driverId) ?? 0;
      const paid = c.rewards[0] ?? null;
      return {
        id: c.id,
        title: c.title,
        target: c.target,
        reward: c.reward,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        live: challengeLive(c, now),
        done,
        reached: done >= c.target,
        paidAt: paid?.paidAt ?? null,
      };
    }),
  );
}

// --- Mises en avant payées des commerces ---

export const SPONSOR_WEEK_DAYS = 7;

export const isSponsored = (until: Date | null | undefined, now = new Date()) => plusActive(until, now);

export function extendSponsor(until: Date | null, weeks: number, now = new Date()): { startsAt: Date; endsAt: Date } {
  const startsAt = isSponsored(until, now) ? (until as Date) : now;
  return { startsAt, endsAt: new Date(startsAt.getTime() + weeks * SPONSOR_WEEK_DAYS * DAY_MS) };
}

// Ordre des listes : commerces mis en avant d'abord (sans changer l'ordre entre eux), le reste ensuite.
export function sponsoredFirst<T extends { sponsored: boolean }>(list: T[]): T[] {
  return [...list.filter((r) => r.sponsored), ...list.filter((r) => !r.sponsored)];
}
