// Repas planifiés et formule cantine (API /api/customer/planned-meals, src/plannedMeals.ts de l'API).
export type PlannedMeal = {
  id: string;
  kind: "ONCE" | "WEEKLY";
  deliverTime: string;
  days: number[];
  deliverAt: string | null;
  endsAt: string | null;
  nextRunAt: string | null;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "DONE";
  estimate: number;
  address: string;
  lastError: string | null;
  restaurant: { id: string; name: string; slug: string; logoUrl: string | null } | null;
  items: { name: string; quantity: number }[];
  runs: { deliverAt: string; orderCode: string | null; error: string | null }[];
  customerName?: string;
  customerPhone?: string;
};

// Jours affichés du lundi au samedi puis dimanche (0 = dimanche, comme l'API).
export const WEEK_DAYS = [
  { day: 1, short: "Lun" },
  { day: 2, short: "Mar" },
  { day: 3, short: "Mer" },
  { day: 4, short: "Jeu" },
  { day: 5, short: "Ven" },
  { day: 6, short: "Sam" },
  { day: 0, short: "Dim" },
] as const;

export const daysLabel = (days: number[], t: (s: string) => string) =>
  WEEK_DAYS.filter((d) => days.includes(d.day))
    .map((d) => t(d.short))
    .join(", ");

export const whenLabel = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
