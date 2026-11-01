"use client";

import { buttonGhost, input } from "@/components/panel/ui";
import { DAYS, type OpeningSlot } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";

// Lundi en premier, dimanche en dernier.
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

// Horaires de la semaine, plusieurs créneaux par jour. Partagé par l'espace restaurant et l'admin.
export default function OpeningHoursEditor({ hours, onChange }: { hours: OpeningSlot[]; onChange: (next: OpeningSlot[]) => void }) {
  const t = useT();
  const setSlot = (index: number, patch: Partial<OpeningSlot>) => onChange(hours.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const sameAsMonday = (fromDays: number[]) => {
    const monday = hours.filter((s) => s.day === 1);
    if (!monday.length) return;
    onChange([...hours.filter((s) => !fromDays.includes(s.day) && s.day !== 1), ...monday, ...fromDays.flatMap((day) => monday.map((s) => ({ ...s, day })))]);
  };

  return (
    <>
      <p className="mb-3 text-sm text-stone-600">
        {t("Sans horaire, le restaurant est considéré ouvert en permanence. Un créneau peut passer minuit (ex. 18:00 à 02:00).")}
      </p>
      <ul className="divide-y divide-stone-100">
        {WEEK.map((day) => {
          const slots = hours.map((s, i) => ({ ...s, i })).filter((s) => s.day === day);
          return (
            <li key={day} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="w-24 font-medium">{t(DAYS[day])}</span>
              {slots.length === 0 && <span className="text-stone-500">{t("Fermé")}</span>}
              {slots.map((s) => (
                <span key={s.i} className="flex items-center gap-1">
                  <input type="time" required value={s.open} onChange={(e) => setSlot(s.i, { open: e.target.value })} className={`${input} w-28`} aria-label={t("Ouverture {day}", { day: t(DAYS[day]) })} />
                  {t("à")}
                  <input type="time" required value={s.close} onChange={(e) => setSlot(s.i, { close: e.target.value })} className={`${input} w-28`} aria-label={t("Fermeture {day}", { day: t(DAYS[day]) })} />
                  <button type="button" onClick={() => onChange(hours.filter((_, j) => j !== s.i))} className="px-1 text-red-700" aria-label={t("Retirer le créneau")}>
                    ×
                  </button>
                </span>
              ))}
              <button type="button" onClick={() => onChange([...hours, { day, open: slots.length ? "18:00" : "11:00", close: slots.length ? "23:00" : "22:00" }])} className="text-emerald-700">
                + {t("créneau")}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => sameAsMonday([2, 3, 4, 5, 6, 0])} className={buttonGhost}>
          {t("Copier le lundi sur toute la semaine")}
        </button>
        <button type="button" onClick={() => sameAsMonday([2, 3, 4, 5])} className={buttonGhost}>
          {t("Copier le lundi du mardi au vendredi")}
        </button>
        {hours.length > 0 && (
          <button type="button" onClick={() => onChange([])} className={buttonGhost}>
            {t("Effacer les horaires")}
          </button>
        )}
      </div>
    </>
  );
}

// Résumé lisible d'une journée : « 11:00–15:00, 18:00–23:00 ».
export function daySummary(hours: OpeningSlot[], day: number): string {
  return hours
    .filter((s) => s.day === day)
    .sort((a, b) => a.open.localeCompare(b.open))
    .map((s) => `${s.open}–${s.close}`)
    .join(", ");
}
