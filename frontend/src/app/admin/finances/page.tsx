"use client";

import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Cash = {
  drivers: {
    id: string;
    name: string;
    phone: string;
    cashHeld: number;
    earnings: number;
    orders: { id: string; code: string; total: number }[];
  }[];
  history: { id: string; amount: number; note: string | null; createdAt: string; driver: { name: string }; _count: { orders: number } }[];
};

type Preview = { id: string; name: string; orderCount: number; orderTotal: number; commission: number; amountDue: number }[];

type Settlement = {
  id: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  orderTotal: number;
  commission: number;
  amountDue: number;
  paidAt: string | null;
  restaurant: { name: string };
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "UTC" });

export default function FinancePage() {
  const cash = useAdmin<Cash>("/finance/cash");
  const [range, setRange] = useState({ from: day(new Date(Date.now() - 6 * 86_400_000)), to: day(new Date()) });
  const preview = useAdmin<Preview>(`/finance/settlements/preview?from=${range.from}&to=${range.to}`);
  const settlements = useAdmin<Settlement[]>("/finance/settlements");
  const action = useAction();

  const collect = (driverId: string, amount: number, name: string) => {
    if (!confirm(`Confirmer la remise de ${fcfa(amount)} par ${name} ?`)) return;
    action.run(async () => {
      await adminFetch("/finance/cash", { method: "POST", body: { driverId } });
      await cash.reload();
    });
  };

  const settle = (restaurantId: string) =>
    action.run(async () => {
      await adminFetch("/finance/settlements", { method: "POST", body: { restaurantId, ...range } });
      await Promise.all([preview.reload(), settlements.reload()]);
    });

  const markPaid = (s: Settlement) =>
    action.run(async () => {
      await adminFetch(`/finance/settlements/${s.id}`, { method: "PATCH", body: { paid: !s.paidAt } });
      await settlements.reload();
    });

  const held = cash.data?.drivers.filter((d) => d.cashHeld > 0) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader icon="wallet" title="Finances" description="Espèces à récupérer auprès des livreurs, relevés et versements aux restaurants." />
      <ErrorNote message={action.error ?? cash.error ?? preview.error ?? settlements.error} />

      <Card title="Espèces détenues par les livreurs">
        {!cash.data ? (
          <Loading />
        ) : held.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune somme à encaisser.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {held.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-stone-500">
                    {d.orders.length} course(s) : {d.orders.map((o) => o.code).join(", ")}
                    {d.earnings > 0 && ` · part livreur ${fcfa(d.earnings)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{fcfa(d.cashHeld)}</span>
                  <button onClick={() => collect(d.id, d.cashHeld, d.name)} className={button}>
                    Encaisser
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cash.data && cash.data.history.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-stone-600">Dernières remises</summary>
            <ul className="mt-2 space-y-1">
              {cash.data.history.map((h) => (
                <li key={h.id} className="flex justify-between">
                  <span>
                    {formatTime(h.createdAt)} · {h.driver.name} · {h._count.orders} course(s)
                  </span>
                  <span>{fcfa(h.amount)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Reversements aux restaurants">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          Commandes livrées du
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={`${input} w-auto`} />
          au
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={`${input} w-auto`} />
        </div>
        {!preview.data ? (
          <Loading />
        ) : preview.data.length === 0 ? (
          <p className="text-sm text-stone-500">Rien à reverser sur cette période.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="py-1 font-normal">Restaurant</th>
                <th className="py-1 text-right font-normal">Cmd</th>
                <th className="py-1 text-right font-normal">Ventes</th>
                <th className="py-1 text-right font-normal">Commission</th>
                <th className="py-1 text-right font-normal">À reverser</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {preview.data.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="py-2">{r.name}</td>
                  <td className="py-2 text-right">{r.orderCount}</td>
                  <td className="py-2 text-right">{fcfa(r.orderTotal)}</td>
                  <td className="py-2 text-right">{fcfa(r.commission)}</td>
                  <td className="py-2 text-right font-semibold">{fcfa(r.amountDue)}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => settle(r.id)} className={buttonGhost}>
                      Clôturer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Relevés">
        {!settlements.data ? (
          <Loading />
        ) : settlements.data.length === 0 ? (
          <p className="text-sm text-stone-500">Aucun relevé pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {settlements.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium">{s.restaurant.name}</p>
                  <p className="text-stone-500">
                    {shortDate(s.periodStart)} – {shortDate(s.periodEnd)} · {s.orderCount} commande(s) · ventes {fcfa(s.orderTotal)} ·
                    commission {fcfa(s.commission)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{fcfa(s.amountDue)}</span>
                  <button onClick={() => markPaid(s)} className={s.paidAt ? buttonGhost : button}>
                    {s.paidAt ? `Payé le ${shortDate(s.paidAt)}` : "Marquer payé"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
