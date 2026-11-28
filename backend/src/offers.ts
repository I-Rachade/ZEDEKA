import type { PrismaClient } from "@prisma/client";

// Offres commerciales de Zedeka : palier Pro des restaurants, tarif boutique des marchands et parrainage des clients.

// --- Palier d'abonnement des commerces ---

// FREE (décision du 28 novembre 2026) : ni abonnement ni commission. Le restaurant reçoit ses commandes lui-même et
// appelle Zedeka pour chaque livraison, payée comme une course (grille des colis).
export const PLANS = ["FREE", "ESSENTIEL", "PRO"] as const;
export type Plan = (typeof PLANS)[number];

type PlanPrices = { vendorSubscriptionFee: number; proSubscriptionFee: number };

// Prix mensuel d'un palier, d'après les réglages (Essentiel : l'abonnement en vigueur ; Free : rien).
export const planFee = (plan: string, s: PlanPrices): number =>
  plan === "FREE" ? 0 : plan === "PRO" ? s.proSubscriptionFee : s.vendorSubscriptionFee;

// Palier Pro conseillé : un restaurant Essentiel qui dépasse le seuil de commandes livrées du mois.
export const proAdvised = (plan: string, deliveredThisMonth: number, limit: number): boolean =>
  plan === "ESSENTIEL" && limit > 0 && deliveredThisMonth > limit;

// Premier jour du mois en cours, minuit UTC (Lomé est à UTC+0).
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// --- Tarif boutique des marchands ---

type FlatRate = { merchantFlatFee: number; merchantFlatFrom: number };

// Prix de livraison d'un colis de marchand : dès que la boutique a déjà envoyé `merchantFlatFrom` colis dans le mois
// (rang du colis compté à partir de 0), la livraison passe au tarif boutique, jamais plus cher que le prix normal.
// Les suppléments de type et de poids restent dus.
export function merchantFee(fee: number, rank: number, s: FlatRate): number {
  if (s.merchantFlatFrom <= 0 || rank < s.merchantFlatFrom) return fee;
  return Math.min(fee, s.merchantFlatFee);
}

// Colis envoyés ce mois par la boutique (hors annulés) : sert de rang de départ pour le tarif boutique.
export const merchantParcelsThisMonth = (prisma: PrismaClient, merchantId: string, now = new Date()) =>
  prisma.order.count({ where: { merchantId, type: "PARCEL", status: { not: "CANCELLED" }, createdAt: { gte: monthStart(now) } } });

// --- Parrainage ---

// Code de parrainage : 6 caractères sans lettres ni chiffres qui se confondent (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newReferralCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

export const normalizeReferralCode = (code: string) => code.trim().toUpperCase().replace(/[\s-]+/g, "");

// Code du client, créé à la première demande (un nouvel essai si le code tiré existe déjà).
export async function referralCodeOf(prisma: PrismaClient, customerId: string): Promise<string> {
  const me = await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { referralCode: true } });
  if (me.referralCode) return me.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode();
    const taken = await prisma.customer.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (taken) continue;
    // Écriture conditionnelle (D1 sans transaction) : deux écrans ouverts ne donnent pas deux codes.
    await prisma.customer.updateMany({ where: { id: customerId, referralCode: null }, data: { referralCode: code } });
    const saved = await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { referralCode: true } });
    if (saved.referralCode) return saved.referralCode;
  }
  throw new Error("Code de parrainage indisponible, réessayez");
}

// Livraisons offertes : une par ami parrainé qui a reçu sa première commande, moins celles déjà utilisées sur une
// commande non annulée (une commande annulée rend donc la livraison offerte).
export async function referralSummary(prisma: PrismaClient, customerId: string) {
  const [invited, rewarded, used] = await Promise.all([
    prisma.customer.count({ where: { referredById: customerId } }),
    prisma.customer.count({ where: { referredById: customerId, orders: { some: { status: "DELIVERED" } } } }),
    prisma.order.count({ where: { customerId, referralCredit: true, status: { not: "CANCELLED" } } }),
  ]);
  return { invited, rewarded, freeDeliveries: Math.max(0, rewarded - used) };
}

// Saisie du code d'un ami : une seule fois, par un client qui n'a encore reçu aucune commande, jamais son propre
// code ni celui de quelqu'un qu'il a lui-même parrainé. Renvoie le message d'erreur à montrer, ou null.
export async function acceptReferral(prisma: PrismaClient, customerId: string, rawCode: string, now = new Date()): Promise<string | null> {
  const code = normalizeReferralCode(rawCode);
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return "Code de parrainage invalide";
  const [me, sponsor, delivered] = await Promise.all([
    prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { referredById: true, referralCode: true } }),
    prisma.customer.findUnique({ where: { referralCode: code }, select: { id: true, referredById: true, deletedAt: true } }),
    prisma.order.count({ where: { customerId, status: "DELIVERED" } }),
  ]);
  if (me.referredById) return "Vous avez déjà indiqué le code d'un ami";
  if (!sponsor || sponsor.deletedAt) return "Code de parrainage inconnu";
  if (sponsor.id === customerId) return "C'est votre propre code : partagez-le à vos amis";
  if (sponsor.referredById === customerId) return "Cet ami a déjà utilisé votre code";
  if (delivered > 0) return "Le parrainage est réservé aux nouveaux clients, avant leur première commande livrée";
  const done = await prisma.customer.updateMany({ where: { id: customerId, referredById: null }, data: { referredById: sponsor.id, referredAt: now } });
  return done.count ? null : "Vous avez déjà indiqué le code d'un ami";
}
