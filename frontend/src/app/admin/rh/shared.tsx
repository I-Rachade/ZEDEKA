"use client";

import { useT } from "@/lib/i18n/client";

// Ressources humaines : types et libellés partagés par la liste, la fiche d'un employé et la paie.

export type ContractType = "CDI" | "CDD" | "STAGE" | "PRESTATAIRE" | "JOURNALIER";
export type EmployeeStatus = "ACTIVE" | "SUSPENDED" | "LEFT";
export type PaymentMethod = "MOBILE_MONEY" | "BANK" | "CASH";
export type LeaveKind = "PAID" | "SICK" | "UNPAID" | "MATERNITY" | "ABSENCE" | "OTHER";
export type LeaveStatus = "REQUESTED" | "APPROVED" | "REJECTED";
export type DocumentKind = "CONTRACT" | "ID" | "DIPLOMA" | "CERTIFICATE" | "PAYSLIP" | "OTHER";
export type PayslipStatus = "DRAFT" | "VALIDATED" | "PAID";

export type EmployeeRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string;
  department: string | null;
  contractType: ContractType;
  startDate: string;
  endDate: string | null;
  monthlySalary: number;
  status: EmployeeStatus;
  driverId: string | null;
};
export type Leave = {
  id: string;
  employeeId: string;
  kind: LeaveKind;
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveStatus;
  reason: string | null;
  decidedBy: string | null;
  createdBy: string | null;
  employee?: { id: string; name: string; position: string; department: string | null; status: EmployeeStatus };
};
export type EmployeeDocument = { id: string; kind: DocumentKind; title: string; contentType: string; size: number; uploadedBy: string | null; createdAt: string };
export type Payslip = {
  id: string;
  employeeId: string;
  month: string;
  baseSalary: number;
  unpaidDays: number;
  absenceDeduction: number;
  bonus: number;
  deductions: number;
  net: number;
  note: string | null;
  status: PayslipStatus;
  validatedBy: string | null;
  paidAt: string | null;
  paidBy: string | null;
  employee?: { id: string; name: string; position: string; department: string | null; paymentMethod: PaymentMethod; paymentAccount: string | null };
};
export type Employee = EmployeeRow & {
  trialEndDate: string | null;
  paymentMethod: PaymentMethod;
  paymentAccount: string | null;
  birthDate: string | null;
  address: string | null;
  idNumber: string | null;
  cnssNumber: string | null;
  emergencyContact: string | null;
  leaveDaysPerYear: number;
  leftAt: string | null;
  leftReason: string | null;
  notes: string | null;
  createdBy: string | null;
  leaves: Leave[];
  documents: EmployeeDocument[];
  payslips: Payslip[];
  driver: { id: string; name: string; phone: string; employment: string; status: string } | null;
  balance: { year: number; entitled: number; taken: number; requested: number; remaining: number };
};

export const CONTRACT_LABEL: Record<ContractType, string> = { CDI: "CDI", CDD: "CDD", STAGE: "Stage", PRESTATAIRE: "Prestataire", JOURNALIER: "Journalier" };
export const STATUS_LABEL: Record<EmployeeStatus, string> = { ACTIVE: "En poste", SUSPENDED: "Suspendu", LEFT: "Parti" };
export const PAYMENT_LABEL: Record<PaymentMethod, string> = { MOBILE_MONEY: "Mobile money", BANK: "Virement bancaire", CASH: "Espèces" };
export const LEAVE_LABEL: Record<LeaveKind, string> = {
  PAID: "Congé payé",
  SICK: "Maladie",
  UNPAID: "Congé sans solde",
  MATERNITY: "Maternité ou paternité",
  ABSENCE: "Absence non justifiée",
  OTHER: "Autre absence",
};
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = { REQUESTED: "À décider", APPROVED: "Accepté", REJECTED: "Refusé" };
export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  CONTRACT: "Contrat de travail",
  ID: "Pièce d'identité",
  DIPLOMA: "Diplôme",
  CERTIFICATE: "Attestation, certificat",
  PAYSLIP: "Bulletin de paie",
  OTHER: "Autre document",
};
export const PAYSLIP_LABEL: Record<PayslipStatus, string> = { DRAFT: "Brouillon", VALIDATED: "Validé, à payer", PAID: "Payé" };

const TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800",
  APPROVED: "bg-emerald-50 text-emerald-800",
  PAID: "bg-emerald-50 text-emerald-800",
  SUSPENDED: "bg-amber-50 text-amber-800",
  REQUESTED: "bg-amber-50 text-amber-800",
  VALIDATED: "bg-sky-50 text-sky-800",
  DRAFT: "bg-stone-100 text-stone-700",
  LEFT: "bg-stone-100 text-stone-600",
  REJECTED: "bg-red-50 text-red-700",
};

export function Pill({ status, label }: { status: string; label: string }) {
  const t = useT();
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status] ?? "bg-stone-100 text-stone-700"}`}>{t(label)}</span>;
}

/** Date courte (22 nov. 2026) dans la langue de l'écran (locale de useI18n). */
export const shortDate = (iso: string | null | undefined, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–";
/** AAAA-MM-JJ pour un champ date. */
export const dayValue = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
/** Mois en toutes lettres (novembre 2026). */
export const monthName = (month: string, locale: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
export const currentMonth = () => new Date().toISOString().slice(0, 7);
export const shiftMonth = (month: string, by: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

/** Fichier choisi → data URL (envoyé tel quel à l'API, qui vérifie le type et le poids). */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Fichier illisible"));
    reader.readAsDataURL(file);
  });
}
