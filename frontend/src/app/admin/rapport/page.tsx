"use client";

import { useState } from "react";
import { fcfa } from "@/lib/api";
import { Card, ErrorNote, Loading } from "../ui";
import { useAdmin } from "../useAdmin";

type Report = {
  days: number;
  totalOrders: number;
  cancelled: number;
  revenue: number;
  revenuePerDay: number;
  breakEvenPerDay: number;
  avgDeliveryMinutes: number | null;
  perDay: { date: string; orders: number; revenue: number; aboveBreakEven: boolean }[];
  perRestaurant: { name: string; orders: number; perDay: number }[];
};

const PERIODS = [
  { days: 7, label: "7 jours" },
  { days: 30, label: "30 jours" },
  { days: 90, label: "Pilote (90 jours)" },
];

export default function ReportPage() {
  const [days, setDays] = useState(7);
  const { data, error } = useAdmin<Report>(`/report?days=${days}`);
  const max = Math.max(data?.breakEvenPerDay ?? 1, ...(data?.perDay.map((d) => d.revenue) ?? [0]));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Rapport</h1>
      <div className="flex gap-1 text-sm">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            onClick={() => setDays(p.days)}
            className={`rounded-full px-3 py-1 ${days === p.days ? "bg-stone-800 text-white" : "bg-white"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <ErrorNote message={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <p className="text-sm text-stone-600">Courses</p>
              <p className="text-xl font-bold">{data.totalOrders}</p>
              <p className="text-xs text-stone-500">{(Math.round((data.totalOrders / data.days) * 10) / 10).toLocaleString("fr-FR")} par jour</p>
            </Card>
            <Card>
              <p className="text-sm text-stone-600">Revenu par jour</p>
              <p className="text-xl font-bold">{fcfa(data.revenuePerDay)}</p>
              <p className="text-xs text-stone-500">seuil {fcfa(data.breakEvenPerDay)}</p>
            </Card>
            <Card>
              <p className="text-sm text-stone-600">Revenu total</p>
              <p className="text-xl font-bold">{fcfa(data.revenue)}</p>
            </Card>
            <Card>
              <p className="text-sm text-stone-600">Délai moyen</p>
              <p className="text-xl font-bold">{data.avgDeliveryMinutes === null ? "–" : `${data.avgDeliveryMinutes} min`}</p>
              <p className="text-xs text-stone-500">{data.cancelled} annulée(s)</p>
            </Card>
          </div>

          <Card title="Revenu Zedeka par jour">
            <div className="space-y-1">
              {data.perDay.map((d) => (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="w-12 shrink-0 text-stone-500">
                    {new Date(d.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                  </span>
                  <div className="relative h-4 flex-1 rounded bg-stone-100">
                    <div
                      className={`h-full rounded ${d.aboveBreakEven ? "bg-emerald-600" : "bg-amber-500"}`}
                      style={{ width: `${(d.revenue / max) * 100}%` }}
                    />
                    <div
                      className="absolute inset-y-0 border-l-2 border-dashed border-stone-500"
                      style={{ left: `${(data.breakEvenPerDay / max) * 100}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right">
                    {d.orders} · {fcfa(d.revenue)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-500">La ligne pointillée marque le seuil de rentabilité.</p>
          </Card>

          <Card title="Commandes par restaurant">
            {data.perRestaurant.length === 0 ? (
              <p className="text-sm text-stone-500">Pas encore de commandes sur la période.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-stone-500">
                  <tr>
                    <th className="py-1 font-normal">Restaurant</th>
                    <th className="py-1 text-right font-normal">Commandes</th>
                    <th className="py-1 text-right font-normal">Par jour</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perRestaurant.map((r) => (
                    <tr key={r.name} className="border-t border-stone-100">
                      <td className="py-1">{r.name}</td>
                      <td className="py-1 text-right">{r.orders}</td>
                      <td className="py-1 text-right">{r.perDay.toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
