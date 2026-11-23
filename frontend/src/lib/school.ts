// Transport scolaire : types et libellés partagés par l'appli client, l'appli conducteur et l'admin.

export type PassKind = "SCHOOL" | "STUDENT";
export type PassStatus = "PENDING" | "ACTIVE" | "PAUSED" | "ENDED" | "REJECTED";
export type Leg = "GO" | "BACK";
export type TripStatus = "PLANNED" | "ON_THE_WAY" | "PICKED_UP" | "DROPPED" | "MISSED" | "CANCELLED";
export type DaySlot = { go?: string; back?: string };
export type Schedule = Partial<Record<string, DaySlot>>;
export type MonthState = { month: string; paid: boolean; inGrace: boolean; suspended: boolean; amount: number; lastPaidMonth: string | null; graceDays: number };
export type Fees = Record<PassKind, { round: number; oneWay: number }>;

export type SchoolTrip = {
  id: string;
  date?: string;
  leg: Leg;
  scheduledAt: string;
  status: TripStatus;
  startedAt: string | null;
  pickedUpAt: string | null;
  droppedAt: string | null;
  codeSkipped: boolean;
  note: string | null;
};

export const KIND_LABEL: Record<PassKind, string> = { SCHOOL: "Écolier", STUDENT: "Étudiant" };
export const KIND_HINT: Record<PassKind, string> = {
  SCHOOL: "Votre enfant, de la maison à l'école et retour, avec un conducteur vérifié et un code de remise.",
  STUDENT: "Vous-même, de chez vous à l'université ou au centre de formation, à vos horaires.",
};
export const PASS_STATUS: Record<PassStatus, { label: string; tone: string }> = {
  PENDING: { label: "En attente de validation", tone: "bg-amber-100 text-amber-800" },
  ACTIVE: { label: "En cours", tone: "bg-emerald-100 text-emerald-800" },
  PAUSED: { label: "En pause", tone: "bg-stone-200 text-stone-700" },
  ENDED: { label: "Terminé", tone: "bg-stone-200 text-stone-700" },
  REJECTED: { label: "Refusé", tone: "bg-red-100 text-red-700" },
};
export const TRIP_STATUS: Record<TripStatus, { label: string; tone: string }> = {
  PLANNED: { label: "Prévu", tone: "bg-stone-100 text-stone-700" },
  ON_THE_WAY: { label: "Conducteur en route", tone: "bg-sky-100 text-sky-800" },
  PICKED_UP: { label: "Pris en charge", tone: "bg-amber-100 text-amber-800" },
  DROPPED: { label: "Arrivé", tone: "bg-emerald-100 text-emerald-800" },
  MISSED: { label: "Non fait", tone: "bg-red-100 text-red-700" },
  CANCELLED: { label: "Annulé", tone: "bg-stone-100 text-stone-500" },
};
export const LEG_LABEL: Record<Leg, string> = { GO: "Aller", BACK: "Retour" };
export const ABSENCE_LEG: Record<"BOTH" | Leg, string> = { BOTH: "Toute la journée", GO: "Aller seulement", BACK: "Retour seulement" };
export const DAYS: { key: string; short: string; long: string }[] = [
  { key: "1", short: "Lun", long: "Lundi" },
  { key: "2", short: "Mar", long: "Mardi" },
  { key: "3", short: "Mer", long: "Mercredi" },
  { key: "4", short: "Jeu", long: "Jeudi" },
  { key: "5", short: "Ven", long: "Vendredi" },
  { key: "6", short: "Sam", long: "Samedi" },
  { key: "7", short: "Dim", long: "Dimanche" },
];

// Heure d'un trajet : Lomé vit à l'heure UTC.
export const hhmm = (iso: string) => iso.slice(11, 16);
export const dayLabel = (date: string, locale: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export const monthLabel = (month: string, locale: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
export const todayKey = () => new Date().toISOString().slice(0, 10);

// Résumé des horaires : « Lun, Mar, Jeu : 06:45 → 17:00 · Mer : 06:45 → 12:00 ».
export function scheduleText(schedule: Schedule, t: (s: string) => string): string {
  const groups = new Map<string, string[]>();
  for (const d of DAYS) {
    const slot = schedule[d.key];
    if (!slot) continue;
    const key = `${slot.go ?? "–"} → ${slot.back ?? "–"}`;
    groups.set(key, [...(groups.get(key) ?? []), t(d.short)]);
  }
  return [...groups.entries()].map(([times, days]) => `${days.join(", ")} : ${times}`).join(" · ");
}
