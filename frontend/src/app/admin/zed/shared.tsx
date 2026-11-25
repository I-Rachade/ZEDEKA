"use client";

import { useT } from "@/lib/i18n/client";

export type ZedStatus = "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED";
export type ZedDriverRow = {
  id: string;
  name: string;
  phone: string;
  plate: string | null;
  status: string;
  active: boolean;
  deliveries: boolean;
  zedStatus: ZedStatus;
  zedAvailable: boolean;
  zedAppliedAt: string | null;
  zedReviewedAt: string | null;
  zedReviewedBy: string | null;
  zedNote: string | null;
  lastLocationAt: string | null;
  zedDocuments: { kind: string; createdAt: string; issuedAt?: string | null; expiresAt?: string | null }[];
  planEndsAt: string | null;
  completedRides: number;
};

export const ZED_STATUS: Record<ZedStatus, { label: string; tone: string }> = {
  PENDING: { label: "À vérifier", tone: "bg-amber-100 text-amber-800" },
  ACTIVE: { label: "Actif", tone: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Refusé", tone: "bg-red-100 text-red-700" },
  SUSPENDED: { label: "Suspendu", tone: "bg-stone-200 text-stone-700" },
};

export const RIDE_STATUS = {
  SCHEDULED: { label: "Réservée", tone: "bg-violet-100 text-violet-800" },
  SEARCHING: { label: "Recherche", tone: "bg-amber-100 text-amber-800" },
  ACCEPTED: { label: "Conducteur en route", tone: "bg-sky-100 text-sky-800" },
  ONBOARD: { label: "Client à bord", tone: "bg-sky-100 text-sky-800" },
  COMPLETED: { label: "Terminée", tone: "bg-emerald-100 text-emerald-800" },
  NO_DRIVER: { label: "Aucun Zed", tone: "bg-red-100 text-red-700" },
  CANCELLED: { label: "Annulée", tone: "bg-stone-200 text-stone-700" },
} as const;

export function ZedPill({ status, available }: { status: ZedStatus; available?: boolean }) {
  const t = useT();
  const s = status === "ACTIVE" && available ? { label: "Disponible", tone: "bg-emerald-600 text-white" } : ZED_STATUS[status];
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${s.tone}`}>{t(s.label)}</span>;
}
