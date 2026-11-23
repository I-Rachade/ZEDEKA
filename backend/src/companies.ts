import type { PrismaClient } from "@prisma/client";
import { formatFcfa } from "./pricing.js";

// Commandes d'entreprise : un bureau ou une école a un compte entreprise (créé par l'équipe dans l'admin) avec la
// liste des numéros de ses membres. Un membre connecté peut faire « Facturer à l'entreprise » à la caisse, dans une
// commande groupée ou un repas planifié : le livreur n'encaisse rien, la commande va sur la facture du mois
// (commandes livrées du 1er au dernier jour), que l'équipe imprime et marque payée. Plafond mensuel facultatif.
// Paiement de la facture hors de l'appli (virement, chèque, espèces au bureau) : aucun paiement en ligne ici.

export const COMPANY_KINDS = ["OFFICE", "SCHOOL"] as const;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

// [début, fin) d'un mois « 2026-11 », en UTC (heure de Lomé).
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

// Entreprises actives dont ce numéro est membre actif.
export async function companiesOf(prisma: PrismaClient, phone: string) {
  if (!phone) return [];
  const rows = await prisma.companyMember.findMany({
    where: { phone, active: true, company: { active: true } },
    select: { company: { select: { id: true, name: true, kind: true, monthlyLimit: true } } },
  });
  return rows.map((r) => r.company);
}

// Montant déjà engagé ce mois (commandes non annulées facturées à l'entreprise).
export async function spentThisMonth(prisma: PrismaClient, companyId: string, now = new Date()) {
  const { from, to } = monthRange(monthOf(now));
  const r = await prisma.order.aggregate({ where: { companyId, status: { not: "CANCELLED" }, createdAt: { gte: from, lt: to } }, _sum: { total: true } });
  return r._sum.total ?? 0;
}

// Peut-on facturer `amount` à cette entreprise pour ce client ? Renvoie le message d'erreur, ou null.
export async function billingError(prisma: PrismaClient, companyId: string, customerPhone: string | null, amount: number, now = new Date()): Promise<string | null> {
  if (!customerPhone) return "Connectez-vous pour facturer à votre entreprise";
  const company = (await companiesOf(prisma, customerPhone)).find((c) => c.id === companyId);
  if (!company) return "Votre numéro n'est pas inscrit dans ce compte entreprise";
  if (company.monthlyLimit > 0) {
    const spent = await spentThisMonth(prisma, companyId, now);
    if (spent + amount > company.monthlyLimit)
      return `Plafond mensuel de l'entreprise atteint (${formatFcfa(company.monthlyLimit)}, reste ${formatFcfa(Math.max(0, company.monthlyLimit - spent))})`;
  }
  return null;
}

// Facture d'un mois : commandes livrées, par date, avec le détail des plats et qui a commandé.
export async function invoiceFor(prisma: PrismaClient, companyId: string, month: string) {
  const { from, to } = monthRange(month);
  const orders = await prisma.order.findMany({
    where: { companyId, status: "DELIVERED", deliveredAt: { gte: from, lt: to } },
    orderBy: { deliveredAt: "asc" },
    select: {
      code: true,
      deliveredAt: true,
      customerName: true,
      customerPhone: true,
      subtotal: true,
      deliveryFee: true,
      extraFee: true,
      discount: true,
      total: true,
      restaurant: { select: { name: true } },
      items: { select: { name: true, variantName: true, quantity: true } },
    },
  });
  const sum = (k: "subtotal" | "deliveryFee" | "total") => orders.reduce((s, o) => s + o[k], 0);
  return { month, orders, count: orders.length, subtotal: sum("subtotal"), deliveryFee: sum("deliveryFee"), total: sum("total") };
}
