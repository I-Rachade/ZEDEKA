import type { PrismaClient } from "@prisma/client";

// Assurance et micro-crédit des livreurs. Zedeka ne prête pas et n'assure pas : la demande est faite dans l'appli
// livreur, l'équipe la transmet à un partenaire (assureur, institution de microfinance) dont elle saisit le nom,
// note sa décision, puis suit le contrat (remboursements notés à la main, sinistres). Aucun partenaire n'est branché.

export const KINDS = ["INSURANCE", "LOAN", "CLAIM"] as const;
export type FinanceKind = (typeof KINDS)[number];
export const STATUSES = ["REQUESTED", "SENT", "APPROVED", "REFUSED", "ACTIVE", "CLOSED", "CANCELLED"] as const;
export type FinanceStatus = (typeof STATUSES)[number];

export const INSURANCE_PRODUCTS = {
  ACCIDENT: "Accident et blessure du livreur",
  BIKE: "Moto (vol, casse)",
  HEALTH: "Santé (soins, hospitalisation)",
  THIRD_PARTY: "Responsabilité civile (dégâts causés à autrui)",
} as const;
export const LOAN_PRODUCTS = {
  REPAIR: "Réparation de la moto",
  EQUIPMENT: "Équipement (casque, sac, téléphone)",
  BIKE: "Apport pour une moto",
  EMERGENCY: "Urgence (santé, famille)",
  OTHER: "Autre besoin",
} as const;
export const CLAIM_PRODUCTS = {
  ACCIDENT: "Accident",
  THEFT: "Vol",
  DAMAGE: "Casse ou panne",
  HEALTH: "Soins",
} as const;
export const PRODUCTS: Record<FinanceKind, Record<string, string>> = { INSURANCE: INSURANCE_PRODUCTS, LOAN: LOAN_PRODUCTS, CLAIM: CLAIM_PRODUCTS };

export const LOAN_MIN = 5_000;
export const LOAN_MAX = 1_000_000;
export const LOAN_MAX_MONTHS = 24;
// Demandes encore ouvertes (pas de deuxième demande du même produit tant que la première n'est pas tranchée).
export const OPEN: FinanceStatus[] = ["REQUESTED", "SENT", "APPROVED", "ACTIVE"];

// Étapes permises par l'équipe : chaque statut n'est atteint que depuis les précédents.
export const NEXT: Record<FinanceStatus, FinanceStatus[]> = {
  REQUESTED: ["SENT", "APPROVED", "REFUSED", "CANCELLED"],
  SENT: ["APPROVED", "REFUSED", "CANCELLED"],
  APPROVED: ["ACTIVE", "CANCELLED", "CLOSED"],
  ACTIVE: ["CLOSED"],
  REFUSED: [],
  CLOSED: [],
  CANCELLED: [],
};
export const canMove = (from: string, to: FinanceStatus) => (NEXT[from as FinanceStatus] ?? []).includes(to);

export const productLabel = (kind: string, product: string) => PRODUCTS[kind as FinanceKind]?.[product] ?? product;

// Reste à rembourser d'un crédit (total dû, sinon montant accordé), jamais négatif.
export function remaining(r: { kind: string; totalDue: number | null; approvedAmount: number | null; repayments: { amount: number }[] }): number | null {
  if (r.kind !== "LOAN") return null;
  const due = r.totalDue ?? r.approvedAmount;
  if (due === null) return null;
  return Math.max(0, due - r.repayments.reduce((s, p) => s + p.amount, 0));
}

export const financeInclude = { repayments: { orderBy: { createdAt: "desc" as const } } };

type Row = {
  id: string;
  kind: string;
  product: string;
  amount: number | null;
  months: number | null;
  note: string | null;
  incidentAt: Date | null;
  parentId: string | null;
  status: string;
  partner: string | null;
  partnerRef: string | null;
  approvedAmount: number | null;
  totalDue: number | null;
  installment: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  staffNote: string | null;
  createdAt: Date;
  repayments: { id: string; amount: number; method: string; reference: string | null; createdAt: Date }[];
};

// Vue d'une demande pour le livreur (sans les notes internes de l'équipe ni qui a fait quoi).
export function driverView(r: Row) {
  return {
    id: r.id,
    kind: r.kind,
    product: r.product,
    productLabel: productLabel(r.kind, r.product),
    amount: r.amount,
    months: r.months,
    note: r.note,
    incidentAt: r.incidentAt,
    parentId: r.parentId,
    status: r.status,
    partner: r.partner,
    approvedAmount: r.approvedAmount,
    totalDue: r.totalDue,
    installment: r.installment,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    createdAt: r.createdAt,
    paid: r.repayments.reduce((s, p) => s + p.amount, 0),
    remaining: remaining(r),
    repayments: r.repayments.map((p) => ({ id: p.id, amount: p.amount, method: p.method, createdAt: p.createdAt })),
  };
}

export async function driverFinance(prisma: PrismaClient, driverId: string) {
  const rows = await prisma.riderFinance.findMany({ where: { driverId }, orderBy: { createdAt: "desc" }, take: 50, include: financeInclude });
  return {
    requests: rows.map(driverView),
    products: { INSURANCE: INSURANCE_PRODUCTS, LOAN: LOAN_PRODUCTS, CLAIM: CLAIM_PRODUCTS },
    loan: { min: LOAN_MIN, max: LOAN_MAX, maxMonths: LOAN_MAX_MONTHS },
  };
}

// Message au livreur à chaque étape de sa demande.
export function statusMessage(kind: string, status: FinanceStatus, partner: string | null): string | null {
  const what = kind === "LOAN" ? "Votre demande de crédit" : kind === "CLAIM" ? "Votre déclaration de sinistre" : "Votre demande d'assurance";
  switch (status) {
    case "SENT":
      return `${what} a été transmise${partner ? ` à ${partner}` : ""}.`;
    case "APPROVED":
      return `${what} est acceptée${partner ? ` par ${partner}` : ""}.`;
    case "REFUSED":
      return `${what} n'a pas été acceptée.`;
    case "ACTIVE":
      return kind === "LOAN" ? "Votre crédit est versé : remboursements dans « Assurance et crédit »." : kind === "CLAIM" ? "Votre sinistre est en cours d'indemnisation." : "Votre assurance est active.";
    case "CLOSED":
      return kind === "LOAN" ? "Votre crédit est entièrement remboursé. Bravo !" : kind === "CLAIM" ? "Votre sinistre est réglé." : "Votre assurance est terminée.";
    case "CANCELLED":
      return `${what} est annulée.`;
    default:
      return null;
  }
}
