"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fcfa } from "@/lib/api";
import { customerFetch, useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useI18n } from "@/lib/i18n/client";
import { daysLabel, whenLabel, type PlannedMeal } from "@/lib/plannedMeals";
import { Empty, Skeleton, TopBar } from "../ui";

// Mes repas planifiés et formules cantine : prochaine livraison, dernières commandes envoyées, pause et annulation.
export default function PlannedMealsPage() {
  const { t, locale } = useI18n();
  const hydrated = useHydrated();
  const session = useSession();
  const [list, setList] = useState<PlannedMeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => customerFetch<PlannedMeal[]>("/planned-meals").then(setList, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function act(id: string, action: "pause" | "resume" | "cancel") {
    if (action === "cancel" && !window.confirm(t("Annuler ce repas planifié ? Les livraisons à venir ne seront pas commandées."))) return;
    setError(null);
    try {
      await customerFetch(`/planned-meals/${id}/${action}`, { method: "POST" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!hydrated) return null;
  return (
    <div className="pb-28">
      <TopBar title="Repas planifiés" back="/app/profil" />
      <div className="space-y-3 px-4 pt-3">
        {!session ? (
          <Link href="/app/connexion?suite=/app/repas-planifies" className="block rounded-2xl bg-emerald-600 px-4 py-3.5 text-center font-semibold text-white">
            {t("Se connecter")}
          </Link>
        ) : list === null ? (
          <Skeleton />
        ) : list.length === 0 ? (
          <Empty icon="clock" title="Aucun repas planifié" />
        ) : (
          list.map((p) => (
            <article key={p.id} className="card-gloss space-y-2 rounded-[16px] p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-emerald-700">{p.kind === "WEEKLY" ? t("Formule cantine") : t("Repas planifié")}</p>
                  <p className="truncate text-[17px] font-bold">{p.restaurant?.name ?? t("Restaurant")}</p>
                </div>
                {p.status === "PAUSED" && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[12px] font-semibold text-stone-600">{t("En pause")}</span>}
              </div>
              <p className="text-[14px]">
                {p.kind === "WEEKLY" ? t("{jours} à {heure}", { jours: daysLabel(p.days, t), heure: p.deliverTime }) : p.deliverAt ? whenLabel(p.deliverAt, locale) : ""}
              </p>
              {p.nextRunAt && p.status === "ACTIVE" && <p className="text-[14px] text-stone-600">{t("Prochaine livraison : {quand}", { quand: whenLabel(p.nextRunAt, locale) })}</p>}
              {p.kind === "WEEKLY" && p.endsAt && <p className="text-[13px] text-stone-500">{t("Jusqu'au {date}", { date: new Date(p.endsAt).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" }) })}</p>}
              <p className="text-[14px] text-stone-600">{p.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</p>
              <p className="text-[14px] font-semibold">{t("Environ {amount} par livraison", { amount: fcfa(p.estimate) })}</p>
              {p.lastError && <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[13px] text-amber-900">{p.lastError}</p>}
              {p.runs.filter((r) => r.orderCode).length > 0 && (
                <p className="text-[13px]">
                  {t("Commandes envoyées :")}{" "}
                  {p.runs
                    .filter((r) => r.orderCode)
                    .slice(0, 3)
                    .map((r, i) => (
                      <span key={r.orderCode}>
                        {i > 0 && ", "}
                        <Link href={`/commande/${r.orderCode}`} className="text-emerald-700 underline">
                          {r.orderCode}
                        </Link>
                      </span>
                    ))}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                {p.status === "ACTIVE" ? (
                  <button type="button" onClick={() => act(p.id, "pause")} className="h-10 flex-1 rounded-xl border border-stone-200 text-[14px] font-semibold">
                    {t("Mettre en pause")}
                  </button>
                ) : (
                  <button type="button" onClick={() => act(p.id, "resume")} className="h-10 flex-1 rounded-xl border border-emerald-700 text-[14px] font-semibold text-emerald-800">
                    {t("Reprendre")}
                  </button>
                )}
                <button type="button" onClick={() => act(p.id, "cancel")} className="h-10 flex-1 rounded-xl border border-red-200 text-[14px] font-semibold text-red-700">
                  {t("Annuler")}
                </button>
              </div>
            </article>
          ))
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
        <p className="px-1 text-[13px] text-stone-500">{t("Pour planifier un repas, remplissez votre panier dans un restaurant puis touchez « Planifier ».")}</p>
      </div>
    </div>
  );
}
