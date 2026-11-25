"use client";

import { useEffect, useState } from "react";
import { card, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch, type DriverChallenge } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";

// Défis : un nombre de livraisons à faire sur une période, et la prime versée par l'équipe une fois l'objectif atteint.
export default function ChallengesPage() {
  const { t, locale } = useI18n();
  const [list, setList] = useState<DriverChallenge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    driverFetch<DriverChallenge[]>("/challenges").then(setList, (e) => setError((e as Error).message));
  }, []);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "Africa/Lome" });

  return (
    <div>
      <TopBar title="Mes défis" back="/livreur/profil" />
      <div className="space-y-3 px-4 py-4">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!list && !error && <Skeleton rows={3} />}
        {list && list.length === 0 && (
          <section className={`${card} p-4 text-sm text-stone-600`}>{t("Aucun défi en ce moment. L'équipe vous prévient quand un nouveau défi commence.")}</section>
        )}
        {list?.map((c) => {
          const pct = Math.min(100, Math.round((c.done / c.target) * 100));
          return (
            <section key={c.id} className={`${card} space-y-2 p-4`}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{c.title}</h2>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-sm font-bold text-emerald-800">{fcfa(c.reward)}</span>
              </div>
              <p className="text-sm text-stone-600">
                {t("{target} livraisons du {from} au {to}", { target: c.target, from: date(c.startsAt), to: date(new Date(new Date(c.endsAt).getTime() - 1).toISOString()) })}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-stone-100" aria-hidden="true">
                <div className={`h-full rounded-full ${c.reached ? "bg-emerald-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-sm font-semibold">
                {c.done} / {c.target}{" "}
                <span className="font-normal text-stone-600">
                  {c.paidAt
                    ? t("Prime versée le {date}", { date: date(c.paidAt) })
                    : c.reached
                      ? t("Objectif atteint : la prime vous sera versée par l'équipe.")
                      : c.live
                        ? t("Encore {n} livraison(s)", { n: c.target - c.done })
                        : t("Défi terminé")}
                </span>
              </p>
            </section>
          );
        })}
      </div>
    </div>
  );
}
