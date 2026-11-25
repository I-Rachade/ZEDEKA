"use client";

import { useEffect, useState } from "react";
import { card, Skeleton, TopBar } from "@/app/app/ui";
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

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PERIODS = [
  { key: "day", label: "Jour", days: 1 },
  { key: "week", label: "Semaine", days: 7 },
  { key: "month", label: "Mois", days: 30 },
] as const;

// Gains du livreur : sa part sur chaque livraison terminée, par jour, semaine ou mois, avec l'évolution et un graphique.
// Un salarié de Zedeka voit son salaire et ses courses, sans montant par course.
export default function EarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("week");
  const t = useT();
  useEffect(() => {
    driverFetch<Earnings>("/earnings").then(setData, (e: Error) => setError(e.message));
    driverFetch<{ rating: number | null }>("/today").then((r) => setRating(r.rating), () => {});
  }, []);
  const staff = data?.employment === "STAFF";
  const span = PERIODS.find((p) => p.key === period)!.days;
  const byDay = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const dayAt = (back: number) => iso(new Date(Date.now() - back * 86_400_000));
  const total = (from: number, n: number) => {
    let amount = 0;
    let count = 0;
    for (let i = from; i < from + n; i++) {
      const d = byDay.get(dayAt(i));
      amount += d?.amount ?? 0;
      count += d?.count ?? 0;
    }
    return { amount, count };
  };
  const now = total(0, span);
  const before = total(span, span);
  const change = before.amount > 0 ? Math.round(((now.amount - before.amount) / before.amount) * 100) : null;
  const bars = Array.from({ length: span === 30 ? 30 : 7 }, (_, i) => {
    const date = dayAt((span === 30 ? 29 : 6) - i);
    return { date, amount: byDay.get(date)?.amount ?? 0, count: byDay.get(date)?.count ?? 0 };
  });
  const max = Math.max(1, ...bars.map((b) => (staff ? b.count : b.amount)));
  const previous = { day: "par rapport à hier", week: "par rapport à la semaine passée", month: "par rapport au mois passé" }[period];

  return (
    <div>
      <TopBar title={staff ? t("Mon activité") : t("Mes gains")} />
      <div className="space-y-4 px-4 py-4">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!data ? (
          !error && <Skeleton rows={3} />
        ) : (
          <>
            <div role="tablist" className="flex gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={period === p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`rounded-full px-4 py-2 text-[14px] font-semibold ${period === p.key ? "bg-emerald-600 text-white" : "bg-stone-200/70 text-stone-700"}`}
                >
                  {t(p.label)}
                </button>
              ))}
            </div>
            {staff && (
              <div className={`${card} p-4`}>
                <p className="text-xs text-stone-500">{t("Salarié Zedeka · salaire mensuel")}</p>
                <p className="text-2xl font-bold">{data.monthlySalary ? fcfa(data.monthlySalary) : t("À confirmer avec Zedeka")}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {!staff && (
                <div className={`${card} p-4`}>
                  <p className="text-[13px] text-stone-500">{t("Gains")}</p>
                  <p className="text-[26px] font-bold leading-tight">{fcfa(now.amount)}</p>
                  {change !== null && (
                    <p className={`mt-1 text-[13px] font-semibold ${change >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {change >= 0 ? "+" : ""}
                      {change} % {t(previous)}
                    </p>
                  )}
                </div>
              )}
              <div className={`${card} p-4 ${staff ? "col-span-2" : ""}`}>
                <p className="text-[13px] text-stone-500">{t("Courses")}</p>
                <p className="text-[26px] font-bold leading-tight">{now.count}</p>
                {rating != null && <p className="mt-1 text-[13px] text-stone-500">★ {t("{n} de moyenne", { n: rating.toFixed(1).replace(".", ",") })}</p>}
              </div>
            </div>
            <section className={`${card} p-4`}>
              <h2 className="font-bold">{staff ? t("Courses par jour") : t("Gains par jour")}</h2>
              <div className="mt-4 flex h-32 items-end gap-2" role="img" aria-label={staff ? t("Courses par jour") : t("Gains par jour")}>
                {bars.map((b, i) => {
                  const v = staff ? b.count : b.amount;
                  const last = i === bars.length - 1;
                  return (
                    <div key={b.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                      <span className={`w-full rounded-t-[3px] ${last ? "bg-emerald-200" : "bg-emerald-600"}`} style={{ height: `${Math.max(v ? 6 : 2, (v / max) * 100)}%` }} title={staff ? String(b.count) : fcfa(b.amount)} />
                      {bars.length === 7 && <span className="text-[11px] uppercase text-stone-500">{new Date(`${b.date}T12:00:00Z`).toLocaleDateString(dateLocale(currentLang()), { weekday: "narrow" })}</span>}
                    </div>
                  );
                })}
              </div>
            </section>
            {data.recent.length > 0 && (
              <section className={`${card} p-4`}>
                <h2 className="font-bold">{t("Dernières courses")}</h2>
                <ul className="mt-2 space-y-2">
                  {data.recent.slice(0, 8).map((o) => (
                    <li key={o.id} className="flex justify-between text-[14px]">
                      <span>
                        {o.code} · {o.zone.name.split(" (")[0]}
                      </span>
                      {!staff && <span className="font-semibold tabular-nums">{fcfa(o.driverEarning)}</span>}
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
