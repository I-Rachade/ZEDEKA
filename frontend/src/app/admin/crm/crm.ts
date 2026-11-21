// Suivi CRM : types partagés par la liste, la fiche et « Mes suivis » (API : backend/src/routes/adminCrm.ts).

export type CrmType = "DRIVER" | "CUSTOMER" | "RESTAURANT" | "MERCHANT";
export type Color = "green" | "orange" | "red" | "grey";
export type Segment = "TOP" | "WATCH" | "NEW" | "INACTIVE" | "VIP" | "LOYAL" | "DORMANT";
export type CrmTask = { id: string; entityType: CrmType; entityId: string; entityName: string; title: string; dueAt: string; assignedTo: string | null; createdBy: string; doneAt: string | null };
export type CrmTag = { id: string; label: string };
export type Column = { key: string; label: string };

export type CrmRow = {
  type: CrmType;
  id: string;
  name: string;
  phone: string | null;
  subtitle: string;
  active: boolean;
  score: number | null;
  color: Color;
  segments: Segment[];
  cols: Record<string, string | number>;
  tags: string[];
  nextTask: Pick<CrmTask, "title" | "dueAt" | "assignedTo"> | null;
  lastActivityAt: string | null;
};
export type CrmList = { columns: Column[]; counts: Record<string, number>; total: number; rows: CrmRow[] };

export type ScorePart = { key: string; label: string; points: number; max: number; detail: string };
export type CrmProfile = Omit<CrmRow, "score" | "tags" | "nextTask"> & {
  score: { value: number | null; parts: ScorePart[] };
  kpis: { label: string; value: string; hint?: string }[];
  tags: CrmTag[];
  tasks: CrmTask[];
  timeline: { at: string; icon: string; text: string; orderId?: string; code?: string; author?: string }[];
  windowDays: number;
  createdAt: string | null;
};

export type CrmAlert = { kind: "WATCH" | "BAD_RATINGS" | "PRAISE" | "DOOR" | "DORMANT"; type: CrmType; id?: string; name: string; text: string };
export type CrmSegmentInfo = { key: Segment; label: string; rule: string; count: number };

export const TYPE_SLUG: Record<CrmType, string> = { DRIVER: "driver", CUSTOMER: "customer", RESTAURANT: "restaurant", MERCHANT: "merchant" };
export const TYPE_LABEL: Record<CrmType, string> = { DRIVER: "Livreurs", CUSTOMER: "Clients", RESTAURANT: "Commerces", MERCHANT: "Marchands" };
export const TYPE_ICON: Record<CrmType, string> = { DRIVER: "🛵", CUSTOMER: "👤", RESTAURANT: "🍽️", MERCHANT: "🛍️" };
export const SEGMENT_LABEL: Record<Segment, string> = { TOP: "Meilleurs", WATCH: "À surveiller", NEW: "Nouveaux", INACTIVE: "Inactifs", VIP: "VIP", LOYAL: "Fidèles", DORMANT: "Endormis" };
export const SEGMENT_STYLE: Record<Segment, string> = {
  TOP: "bg-violet-100 text-violet-800",
  WATCH: "bg-red-100 text-red-800",
  NEW: "bg-sky-100 text-sky-800",
  INACTIVE: "bg-stone-200 text-stone-700",
  VIP: "bg-violet-100 text-violet-800",
  LOYAL: "bg-emerald-100 text-emerald-800",
  DORMANT: "bg-amber-100 text-amber-900",
};
export const SCORE_STYLE: Record<Color, string> = {
  green: "bg-emerald-100 text-emerald-800",
  orange: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-800",
  grey: "bg-stone-100 text-stone-500",
};
export const NOTE_KIND_LABEL = { NOTE: "Remarque", CALL: "Appel", WARNING: "Avertissement", PRAISE: "Félicitations" } as const;
export type NoteKind = keyof typeof NOTE_KIND_LABEL;

export const typeFromSlug = (slug: string): CrmType | null => (Object.entries(TYPE_SLUG).find(([, s]) => s === slug)?.[0] as CrmType | undefined) ?? null;
export const profileHref = (type: CrmType, id: string) => `/admin/crm/${TYPE_SLUG[type]}/${encodeURIComponent(id)}`;

// Date courte d'un rappel : « aujourd'hui », « en retard » ou le jour.
export function dueLabel(iso: string, t: (s: string, v?: Record<string, string | number>) => string, locale: string) {
  const due = new Date(iso);
  const today = new Date();
  const day = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const diff = day(due) - day(today);
  if (diff < 0) return t("En retard ({date})", { date: due.toLocaleDateString(locale, { day: "numeric", month: "short" }) });
  if (diff === 0) return t("Aujourd'hui");
  if (diff === 1) return t("Demain");
  return due.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

// Fichier CSV (ouvert par Excel) à partir des lignes affichées.
export function downloadCsv(filename: string, header: string[], lines: (string | number | null)[][]) {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [header, ...lines].map((l) => l.map(esc).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
