// Réservation à l'avance (course Zed, retrait d'un colis) : jour et heure, de 30 minutes à 7 jours, par quarts
// d'heure. Lomé vit à l'heure UTC, comme l'API : les jours et les heures se lisent en UTC.
import { slotIso } from "./serviceRequests";

const BOOK_MIN_MS = 30 * 60_000;
const QUARTERS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
export function bookingDays(locale: string, now: Date) {
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    const value = d.toISOString().slice(0, 10);
    const times = QUARTERS.filter((h) => {
      const at = new Date(slotIso(value, h)).getTime();
      return at >= now.getTime() + BOOK_MIN_MS && at <= now.getTime() + 7 * 86_400_000;
    });
    const label = i === 0 ? "Aujourd'hui" : i === 1 ? "Demain" : d.toLocaleDateString(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
    return { value, label, times };
  }).filter((d) => d.times.length);
}
// « Demain à 17:00 », « jeu. 13 à 08:30 » : jour relatif à aujourd'hui (UTC).
export function whenLabel(iso: string, locale: string, t: (s: string, v?: Record<string, string | number>) => string) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000);
  const day = diff === 0 ? t("Aujourd'hui") : diff === 1 ? t("Demain") : d.toLocaleDateString(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
  return t("{jour} à {heure}", { jour: day, heure: iso.slice(11, 16) });
}
