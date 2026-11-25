"use client";

import { useState } from "react";
import { Icon } from "@/components/panel/icons";
import { whenLabel } from "@/lib/booking";
import { driverFetch, type ScheduledPickup } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";

// Retraits programmés réservés par le livreur : il reste libre jusqu'à l'heure. Rappel 45 min avant (« Je
// confirme »), puis la course passe dans « Course en cours » 30 min avant. Sans confirmation, elle part à un autre
// livreur. Désistement possible jusqu'à 1 h avant ; ensuite, « Un problème ? » sur la course.
export default function ScheduledPickups({ list, now, onChange }: { list: ScheduledPickup[]; now: number; onChange: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "confirm" | "release") {
    setBusy(id);
    setError(null);
    try {
      await driverFetch(`/orders/${id}/slot/${action}`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      await onChange();
    }
  }

  if (list.length === 0) return null;

  return (
    <section aria-label={t("Mes retraits programmés")}>
      <h2 className="text-[17px] font-bold">{t("Mes retraits programmés")}</h2>
      <p className="text-[13px] text-stone-500">{t("Vous restez libre jusqu'à l'heure. Rappel 45 min avant : confirmez, sinon la course passe à un autre livreur.")}</p>
      <ul className="mt-2 space-y-2">
        {list.map((o) => {
          const remind = !o.slotConfirmedAt && !!o.slotReminderAt;
          const canRelease = now < new Date(o.releasableUntil).getTime();
          return (
            <li key={o.id} className={`rounded-[12px] p-3 ${remind ? "border border-sun bg-sun-soft" : "bg-stone-100"}`}>
              <div className="flex items-center gap-3">
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] ${o.slotConfirmedAt ? "bg-emerald-600 text-white" : "bg-surface text-ink-deep"}`} aria-hidden="true">
                  <Icon name="clock" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">
                    {whenLabel(o.pickupAt!, locale, t)} · {o.code}
                  </span>
                  <span className="block truncate text-[13px] text-stone-600">
                    {o.pickupAddress} → {o.address}
                  </span>
                  <span className={`block text-[12px] font-semibold ${o.slotConfirmedAt ? "text-emerald-700" : "text-stone-500"}`}>
                    {o.slotConfirmedAt ? t("Confirmé") : remind ? t("À confirmer maintenant") : t("Réservé")}
                  </span>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {canRelease && (
                  <button type="button" disabled={busy === o.id} onClick={() => act(o.id, "release")} className="px-2 py-2 text-[13px] font-semibold text-red-700">
                    {t("Me désister")}
                  </button>
                )}
                {!o.slotConfirmedAt && (
                  <button type="button" disabled={busy === o.id} onClick={() => act(o.id, "confirm")} className="rounded-[10px] bg-ink-deep px-3 py-2 text-[13px] font-semibold text-sun">
                    {t("Je confirme")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
