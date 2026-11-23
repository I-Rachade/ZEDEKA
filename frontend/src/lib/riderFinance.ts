// Assurance et micro-crédit des livreurs : appli livreur (« Assurance et crédit ») et admin.

export type FinanceKind = "INSURANCE" | "LOAN" | "CLAIM";
export type FinanceStatus = "REQUESTED" | "SENT" | "APPROVED" | "REFUSED" | "ACTIVE" | "CLOSED" | "CANCELLED";
export type FinancePayment = { id: string; amount: number; method: "CASH" | "FLOOZ" | "TMONEY"; reference?: string | null; recordedBy?: string | null; createdAt: string };
export type FinanceRequest = {
  id: string;
  kind: FinanceKind;
  product: string;
  productLabel: string;
  amount: number | null;
  months: number | null;
  note: string | null;
  incidentAt: string | null;
  parentId: string | null;
  status: FinanceStatus;
  partner: string | null;
  approvedAmount: number | null;
  totalDue: number | null;
  installment: number | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  paid: number;
  remaining: number | null;
  repayments: FinancePayment[];
};
export type DriverFinance = {
  requests: FinanceRequest[];
  products: Record<FinanceKind, Record<string, string>>;
  loan: { min: number; max: number; maxMonths: number };
};

export const KIND_LABEL: Record<FinanceKind, string> = { INSURANCE: "Assurance", LOAN: "Micro-crédit", CLAIM: "Sinistre" };
export const FINANCE_STATUS: Record<FinanceStatus, [string, string]> = {
  REQUESTED: ["Demandée", "bg-sky-100 text-sky-800"],
  SENT: ["Chez le partenaire", "bg-violet-100 text-violet-800"],
  APPROVED: ["Acceptée", "bg-emerald-100 text-emerald-800"],
  REFUSED: ["Refusée", "bg-red-100 text-red-700"],
  ACTIVE: ["En cours", "bg-emerald-600 text-white"],
  CLOSED: ["Terminée", "bg-stone-200 text-stone-700"],
  CANCELLED: ["Annulée", "bg-stone-200 text-stone-700"],
};
export const METHOD_LABEL: Record<FinancePayment["method"], string> = { CASH: "Espèces", FLOOZ: "Flooz", TMONEY: "T-Money" };
