"use client";

import { useEffect, useState } from "react";
import { card, Empty, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch } from "@/lib/driver";
import { currentLang, dateLocale } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

type Earnings = {
  today: number;
  week: number;
  month: number;
  todayCount: number;
  weekCount: number;
  monthCount: number;
  days: { date: string; amount: number; count: number }[];
  employment: "FREELANCE" | "STAFF";
  monthlySalary: number | null;
  recent: { id: string; code: string; type: "FOOD" | "PARCEL"; driverEarning: number; deliveredAt: string; zone: { name: string } }[];
};

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale(currentLang()), { weekday: "long", day: "numeric", month: "long" });

// Gains du livreur : sa part sur chaque livraison terminée. Un salarié de Zedeka voit son salaire et ses courses, sans montant par course.
export default function EarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  useEffect(() => {
    driverFetch<Earnings>("/earnings").then(setData, (e: Error) => setError(e.message));
  }, []);
  const staff = data?.employment === "STAFF";

  return (
    <div>
      <TopBar title={staff ? t("Mon activité") : t("Mes gains")} />
      <div className="space-y-4 px-4 py-4">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!data ? (
          !error && <Skeleton rows={3} />
        ) : (
          <>
            {staff && (
              <div className={`${card} p-4`}>
                <p className="text-xs text-stone-500">{t("Salarié Zedeka · salaire mensuel")}</p>
                <p className="text-2xl font-bold">{data.monthlySalary ? fcfa(data.monthlySalary) : t("À confirmer avec Zedeka")}</p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Aujourd'hui", data.today, data.todayCount],
                ["7 jours", data.week, data.weekCount],
                ["Ce mois", data.month, data.monthCount],
              ].map(([label, amount, count]) => (
                <div key={label} className={`${card} p-3`}>
                  <p className="text-xs text-stone-500">{t(String(label))}</p>
                  {staff ? (
                    <>
                      <p className="text-lg font-bold">{count}</p>
                      <p className="text-xs text-stone-500">{t("course(s)")}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-bold">{fcfa(Number(amount))}</p>
                      <p className="text-xs text-stone-500">{t("{n} course(s)", { n: Number(count) })}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
            <section className={card}>
              <h2 className="px-4 pt-4 font-semibold">{t("Par jour")}</h2>
              {data.days.length === 0 ? (
                <Empty icon="chart" title="Pas encore de livraison" />
              ) : (
                <ul className="divide-y divide-stone-100">
                  {data.days.map((d) => (
                    <li key={d.date} className="flex justify-between px-4 py-3 text-sm">
                      <span className="first-letter:uppercase">
                        {dayLabel(d.date)} · {t("{n} course(s)", { n: d.count })}
                      </span>
                      {!staff && <span className="font-semibold">{fcfa(d.amount)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {data.recent.length > 0 && (
              <section className={card}>
                <h2 className="px-4 pt-4 font-semibold">{t("Dernières courses")}</h2>
                <ul className="divide-y divide-stone-100">
                  {data.recent.map((o) => (
                    <li key={o.id} className="flex justify-between px-4 py-3 text-sm">
                      <span>
                        {o.code} · {o.type === "FOOD" ? t("Repas") : t("Colis")} · {o.zone.name.split(" (")[0]}
                      </span>
                      {!staff && <span className="font-semibold">{fcfa(o.driverEarning)}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-center text-xs text-stone-500">
              {staff
                ? t("Vous êtes payé au mois : les courses ne donnent pas de part en plus du salaire.")
                : t("Votre part est calculée sur les frais de livraison, selon le taux fixé par Zedeka.")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
