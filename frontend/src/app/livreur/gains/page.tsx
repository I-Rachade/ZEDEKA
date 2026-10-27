"use client";

import { useEffect, useState } from "react";
import { card, Empty, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch } from "@/lib/driver";

type Earnings = {
  today: number;
  week: number;
  month: number;
  todayCount: number;
  weekCount: number;
  monthCount: number;
  days: { date: string; amount: number; count: number }[];
  recent: { id: string; code: string; type: "FOOD" | "PARCEL"; driverEarning: number; deliveredAt: string; zone: { name: string } }[];
};

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

// Gains du livreur : sa part sur chaque livraison terminée.
export default function EarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    driverFetch<Earnings>("/earnings").then(setData, (e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <TopBar title="Mes gains" />
      <div className="space-y-4 px-4 py-4">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!data ? (
          !error && <Skeleton rows={3} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Aujourd'hui", data.today, data.todayCount],
                ["7 jours", data.week, data.weekCount],
                ["Ce mois", data.month, data.monthCount],
              ].map(([label, amount, count]) => (
                <div key={label} className={`${card} p-3`}>
                  <p className="text-xs text-stone-500">{label}</p>
                  <p className="text-lg font-bold">{fcfa(Number(amount))}</p>
                  <p className="text-xs text-stone-500">{count} course(s)</p>
                </div>
              ))}
            </div>
            <section className={card}>
              <h2 className="px-4 pt-4 font-semibold">Par jour</h2>
              {data.days.length === 0 ? (
                <Empty icon="chart" title="Pas encore de livraison" />
              ) : (
                <ul className="divide-y divide-stone-100">
                  {data.days.map((d) => (
                    <li key={d.date} className="flex justify-between px-4 py-3 text-sm">
                      <span className="first-letter:uppercase">
                        {dayLabel(d.date)} · {d.count} course(s)
                      </span>
                      <span className="font-semibold">{fcfa(d.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {data.recent.length > 0 && (
              <section className={card}>
                <h2 className="px-4 pt-4 font-semibold">Dernières courses</h2>
                <ul className="divide-y divide-stone-100">
                  {data.recent.map((o) => (
                    <li key={o.id} className="flex justify-between px-4 py-3 text-sm">
                      <span>
                        {o.code} · {o.type === "FOOD" ? "Repas" : "Colis"} · {o.zone.name.split(" (")[0]}
                      </span>
                      <span className="font-semibold">{fcfa(o.driverEarning)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-center text-xs text-stone-500">Votre part est calculée sur les frais de livraison, selon le taux fixé par Zedeka.</p>
          </>
        )}
      </div>
    </div>
  );
}
