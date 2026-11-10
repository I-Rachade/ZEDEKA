"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { driverFetch } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";

type Upcoming = { id: string; code: string; scheduledFor: string; landmark: string | null; destination: string | null; distance: string | null; mine: boolean };

// Courses réservées à l'avance par les clients : le conducteur Zed retient celles qui l'arrangent (pas deux à
// moins d'une heure d'écart). 15 minutes avant l'heure, une course retenue devient sa course en cours ; une
// course que personne n'a retenue part en appel normal aux Zed proches.
export default function UpcomingRides() {
  const { t, locale } = useI18n();
  const [list, setList] = useState<Upcoming[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => driverFetch<Upcoming[]>("/zed/upcoming").then(setList, () => setList([])), []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(id: string, action: "reserve" | "release") {
    setBusy(id);
    setError(null);
    try {
      await driverFetch(`/zed/upcoming/${id}/${action}`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      load();
    }
  }

  if (!list || list.length === 0) return null;
  const when = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const diff = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000);
    const day = diff === 0 ? t("Aujourd'hui") : diff === 1 ? t("Demain") : d.toLocaleDateString(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
    return t("{jour} à {heure}", { jour: day, heure: iso.slice(11, 16) });
  };

  return (
    <section aria-label={t("Courses à venir")}>
      <h2 className="text-[17px] font-bold">{t("Courses à venir")}</h2>
      <p className="text-[13px] text-stone-500">{t("Réservées par des clients. Retenez celles qui vous arrangent : on vous prévient 15 minutes avant.")}</p>
      <ul className="mt-2 space-y-2">
        {list.map((r) => (
          <li key={r.id} className={`flex items-center gap-3 rounded-[12px] p-3 ${r.mine ? "bg-emerald-50" : "bg-stone-100"}`}>
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] ${r.mine ? "bg-emerald-600 text-white" : "bg-surface text-ink-deep"}`} aria-hidden="true">
              <Icon name="clock" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{when(r.scheduledFor)}</span>
              <span className="block truncate text-[13px] text-stone-600">
                {[r.destination && `→ ${r.destination}`, r.distance && t("à {d} de vous", { d: r.distance }), r.landmark].filter(Boolean).join(" · ")}
              </span>
            </span>
            {r.mine ? (
              <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "release")} className="shrink-0 text-[13px] font-semibold text-red-700">
                {t("Me désister")}
              </button>
            ) : (
              <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "reserve")} className="shrink-0 rounded-[10px] bg-ink-deep px-3 py-2 text-[13px] font-semibold text-sun">
                {t("Retenir")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
