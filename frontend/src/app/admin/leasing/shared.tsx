"use client";

import { useT } from "@/lib/i18n/client";

// Leasing de motos : types, libellés et badges partagés par la liste et la fiche d'un contrat.

export type LeaseKind = "HOME" | "ZEDEKA";
export type LeaseState = "PAID" | "DUE_TODAY" | "LATE" | "ENDED";
export type LeaseBalance = {
  state: LeaseState;
  daysDue: number;
  paidDays: number;
  paidUntil: string | null;
  lateDays: number;
  owed: number;
  credit: number;
  paid: number;
};
export type LeaseDriver = { id: string; name: string; phone: string; online: boolean; zedStatus: string | null; deliveries: boolean };
export type LeaseContract = {
  id: string;
  driverId: string;
  kind: LeaseKind;
  plate: string;
  label: string | null;
  dailyRate: number;
  startsAt: string;
  status: "ACTIVE" | "ENDED";
  deposit: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  endedAt: string | null;
  endReason: string | null;
  driver: LeaseDriver;
  balance: LeaseBalance;
};
export type LeasePayment = {
  id: string;
  amount: number;
  days: number;
  method: "CASH" | "FLOOZ" | "TMONEY";
  reference: string | null;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  reviewedAt: string | null;
  reviewedBy: string | null;
  note: string | null;
  createdAt: string;
};

export const KIND_LABEL: Record<LeaseKind, string> = { HOME: "Moto rechargeable à la maison", ZEDEKA: "Moto Zedeka" };
export const METHOD_LABEL: Record<LeasePayment["method"], string> = { CASH: "Espèces", FLOOZ: "Flooz", TMONEY: "T-Money" };
export const PAYMENT_STATUS: Record<LeasePayment["status"], { label: string; tone: string }> = {
  PENDING: { label: "À confirmer", tone: "bg-amber-100 text-amber-800" },
  CONFIRMED: { label: "Confirmé", tone: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Refusé", tone: "bg-red-100 text-red-700" },
};

// Jour du contrat (AAAA-MM-JJ ou date ISO à minuit UTC) : Lomé vit à l'heure UTC.
export const day = (iso: string, locale = "fr-FR") => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function LeasePill({ balance }: { balance: LeaseBalance }) {
  const t = useT();
  const { state, lateDays } = balance;
  const [label, tone] =
    state === "LATE"
      ? [t("En retard ({n} j)", { n: lateDays }), "bg-red-100 text-red-700"]
      : state === "DUE_TODAY"
        ? [t("À payer aujourd'hui"), "bg-amber-100 text-amber-800"]
        : state === "ENDED"
          ? [t("Terminé"), "bg-stone-200 text-stone-700"]
          : [t("À jour"), "bg-emerald-100 text-emerald-800"];
  return <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${tone}`}>{label}</span>;
}
