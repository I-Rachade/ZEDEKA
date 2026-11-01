// Ouverture d'un restaurant. Lomé est à UTC+0 toute l'année : l'heure UTC est l'heure locale.

import { z } from "zod";

export type OpeningSlot = { day: number; open: string; close: string };

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "heure au format HH:MM");

// Horaires de la semaine (0 = dimanche), plusieurs créneaux par jour possibles. Saisis par l'admin ou le gérant.
export const openingHoursInput = z
  .array(z.object({ day: z.number().int().min(0).max(6), open: hhmm, close: hhmm }))
  .max(21, "21 créneaux au maximum")
  .refine((slots) => slots.every((s) => s.open !== s.close), "Un créneau doit avoir une heure d'ouverture et une heure de fermeture différentes")
  .transform((slots) => [...slots].sort((a, b) => a.day - b.day || a.open.localeCompare(b.open)));

export function parseHours(value: unknown): OpeningSlot[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is OpeningSlot =>
      typeof s?.day === "number" && /^\d{2}:\d{2}$/.test(s?.open) && /^\d{2}:\d{2}$/.test(s?.close),
  );
}

// Sans horaires définis, le restaurant est considéré ouvert. Un créneau peut passer minuit (ex. 18:00–02:00).
export function isOpenAt(slots: OpeningSlot[], at: Date): boolean {
  if (slots.length === 0) return true;
  const day = at.getUTCDay();
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return slots.some((s) => {
    const open = toMinutes(s.open);
    const close = toMinutes(s.close);
    if (close > open) return s.day === day && minutes >= open && minutes < close;
    // créneau de nuit : partie du jour même, puis partie du lendemain
    return (s.day === day && minutes >= open) || ((s.day + 1) % 7 === day && minutes < close);
  });
}

const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

// Prochaine ouverture après `at` (dans les 7 jours), ou null sans horaires.
export function nextOpening(slots: OpeningSlot[], at: Date): Date | null {
  const dayStart = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  let best: number | null = null;
  for (let offset = 0; offset <= 7; offset++) {
    const day = (at.getUTCDay() + offset) % 7;
    for (const s of slots) {
      if (s.day !== day) continue;
      const t = dayStart + offset * 86_400_000 + toMinutes(s.open) * 60_000;
      if (t > at.getTime() && (best === null || t < best)) best = t;
    }
    if (best !== null) break;
  }
  return best === null ? null : new Date(best);
}

// « aujourd'hui à 11:00 », « demain à 11:00 », « lundi à 11:00 ».
export function describeOpening(when: Date, at: Date): string {
  const days = Math.round(
    (Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()) - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())) / 86_400_000,
  );
  const time = when.toISOString().slice(11, 16);
  const label = days === 0 ? "aujourd'hui" : days === 1 ? "demain" : DAY_NAMES[when.getUTCDay()];
  return `${label} à ${time}`;
}

export type Availability = { open: boolean; reason: string | null };

// Fermeture temporaire : sans date de fin, jusqu'à réouverture manuelle ; sinon jusqu'à closedUntil.
export function closedNow(r: { temporarilyClosed: boolean; closedUntil?: Date | null }, at = new Date()): boolean {
  return r.temporarilyClosed && (!r.closedUntil || r.closedUntil > at);
}

export function availability(
  r: { active: boolean; temporarilyClosed: boolean; closedUntil?: Date | null; openingHours: unknown },
  at = new Date(),
): Availability {
  if (!r.active) return { open: false, reason: "Ce restaurant ne prend pas de commandes pour le moment." };
  if (closedNow(r, at)) return { open: false, reason: "Le restaurant est momentanément fermé." };
  const slots = parseHours(r.openingHours);
  if (!isOpenAt(slots, at)) {
    const next = nextOpening(slots, at);
    return { open: false, reason: next ? `Le restaurant est fermé à cette heure-ci. Ouverture ${describeOpening(next, at)}.` : "Le restaurant est fermé à cette heure-ci." };
  }
  return { open: true, reason: null };
}
