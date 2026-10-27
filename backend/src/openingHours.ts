// Ouverture d'un restaurant. Lomé est à UTC+0 toute l'année : l'heure UTC est l'heure locale.

export type OpeningSlot = { day: number; open: string; close: string };

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

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

export type Availability = { open: boolean; reason: string | null };

export function availability(
  r: { active: boolean; temporarilyClosed: boolean; openingHours: unknown },
  at = new Date(),
): Availability {
  if (!r.active) return { open: false, reason: "Ce restaurant ne prend pas de commandes pour le moment." };
  if (r.temporarilyClosed) return { open: false, reason: "Le restaurant est momentanément fermé." };
  if (!isOpenAt(parseHours(r.openingHours), at)) return { open: false, reason: "Le restaurant est fermé à cette heure-ci." };
  return { open: true, reason: null };
}
