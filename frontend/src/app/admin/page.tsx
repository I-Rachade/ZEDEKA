"use client";

import Link from "next/link";
import { useState } from "react";
import { fcfa } from "@/lib/api";
import { STATUS_LABEL, type AdminOrderStatus } from "@/lib/admin";
import { Card, ErrorNote, Loading, PageHeader, StatusBadge } from "./ui";
import { useAdmin } from "./useAdmin";

type Dashboard = {
  money?: boolean; // false pour un dispatcheur : pas de montants
  today: {
    orders: number;
    parcels: number;
    revenue: number;
    orderValue: number;
    breakEven: number;
    subscriptions?: number;
    subscribedRestaurants?: number;
    salaries?: number;
    staffDrivers?: number;
    afterSalaries?: number;
    avgDeliveryMinutes?: number | null;
  };
  pendingDrivers: number;
  byStatus: Record<AdminOrderStatus, number>;
  byHour?: number[];
  byZone?: { name: string; count: number }[];
  recent: {
    id: string;
    code: string;
    type: "FOOD" | "PARCEL";
    status: AdminOrderStatus;
    total: number;
    createdAt: string;
    restaurant: { name: string } | null;
    driver: { name: string } | null;
  }[];
};

// Statuts dans l'ordre du parcours, du plus clair au plus foncé ; annulée en gris à part.
const PIPELINE: { status: AdminOrderStatus; color: string }[] = [
  { status: "PENDING", color: "bg-emerald-200" },
  { status: "CONFIRMED", color: "bg-emerald-300" },
  { status: "PREPARING", color: "bg-emerald-400" },
  { status: "READY", color: "bg-emerald-500" },
  { status: "PICKED_UP", color: "bg-emerald-700" },
  { status: "DELIVERED", color: "bg-emerald-900" },
  { status: "CANCELLED", color: "bg-stone-300" },
];
const OPEN: AdminOrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY"];
const URGENT_MIN = 10;

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

// Commandes par heure, 7 h – 23 h : barres fines, l'heure la plus chargée en foncé, valeur au survol.
function HourChart({ byHour }: { byHour: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const hours = Array.from({ length: 17 }, (_, i) => i + 7);
  const max = Math.max(4, ...hours.map((h) => byHour[h]));
  const peak = Math.max(...hours.map((h) => byHour[h]));
  const W = 340, H = 140, L = 22, B = 18, bw = (W - L) / hours.length;
  const y = (v: number) => (H - B) * (1 - v / max);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label="Commandes par heure aujourd'hui">
        {[0, Math.round(max / 2), max].map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} className="stroke-stone-100" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" className="fill-stone-400 text-[9px]">
              {v}
            </text>
          </g>
        ))}
        {hours.map((h, i) => {
          const v = byHour[h];
          const x = L + i * bw + 2;
          return (
            <g key={h} onPointerEnter={() => setHover(h)} onPointerLeave={() => setHover(null)}>
              <rect x={L + i * bw} y={0} width={bw} height={H - B} fill="transparent" />
              {v > 0 && <rect x={x} y={y(v)} width={bw - 4} height={H - B - y(v)} rx="3" className={v === peak ? "fill-emerald-700" : hover === h ? "fill-emerald-500" : "fill-emerald-400"} />}
              {i % 2 === 0 && (
                <text x={x + (bw - 4) / 2} y={H - 4} textAnchor="middle" className="fill-stone-400 text-[9px]">
                  {h}h
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <p className="pointer-events-none absolute right-0 top-0 rounded-md bg-ink px-2 py-1 text-xs text-white">
          {hover} h – {hover + 1} h · {byHour[hover]} commande{byHour[hover] > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { data, error } = useAdmin<Dashboard>("/dashboard");
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const { today } = data;
  const money = data.money !== false;
  const progress = Math.min(100, Math.round((today.revenue / today.breakEven) * 100));
  const perOrder = today.orders ? (today.revenue - (today.subscriptions ?? 0)) / today.orders : 0;
  const ordersLeft = today.revenue < today.breakEven && perOrder > 0 ? Math.ceil((today.breakEven - today.revenue) / perOrder) : null;
  const totalToday = PIPELINE.reduce((sum, p) => sum + data.byStatus[p.status], 0);
  const toHandle = data.recent
    .filter((o) => OPEN.includes(o.status) && !o.driver)
    .map((o) => ({ ...o, age: minutesSince(o.createdAt) }))
    .sort((a, b) => b.age - a.age);
  const zoneMax = Math.max(1, ...(data.byZone ?? []).map((z) => z.count));

  return (
    <div className="space-y-4">
      <PageHeader
        icon="home"
        title="Aujourd'hui"
        description={money ? `Courses et revenu Zedeka du jour, face au seuil de rentabilité de ${fcfa(today.breakEven)}.` : "Courses du jour, à traiter et en cours."}
      />
      {data.pendingDrivers > 0 && (
        <Link href="/admin/livreurs" className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {data.pendingDrivers} candidature(s) de livreur à examiner
        </Link>
      )}

      <Card
        title="À traiter"
        action={
          <Link href="/admin/dispatch" className="text-sm text-emerald-700">
            Répartition
          </Link>
        }
      >
        {toHandle.length === 0 ? (
          <p className="text-sm text-stone-500">Rien en attente : toutes les commandes récentes ont un livreur.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {toHandle.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/commandes/${o.id}`} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      <span className="tracking-wide">{o.code}</span> · {o.type === "PARCEL" ? "Colis" : o.restaurant?.name}
                    </span>
                    <span className="text-stone-500">
                      {STATUS_LABEL[o.status]} · {fcfa(o.total)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${o.age >= URGENT_MIN ? "bg-red-100 text-red-800" : "bg-sun-soft text-amber-900"}`}
                  >
                    {o.age} min sans livreur
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className={`grid grid-cols-2 gap-3 ${money ? "lg:grid-cols-4" : ""}`}>
        <Card>
          <p className="text-sm text-stone-600">Courses</p>
          <p className="font-display text-2xl font-extrabold tabular-nums">{today.orders}</p>
          <p className="text-xs text-stone-500">dont {today.parcels} colis</p>
        </Card>
        {money && (
          <Card>
            <p className="text-sm text-stone-600">Revenu Zedeka</p>
            <p className="font-display text-2xl font-extrabold tabular-nums">{fcfa(today.revenue)}</p>
            {!!today.subscriptions && (
              <p className="text-xs text-stone-500">
                dont {fcfa(today.subscriptions)} d&apos;abonnements ({today.subscribedRestaurants} commerce(s), part du jour)
              </p>
            )}
            {!!today.salaries && (
              <p className="text-xs text-stone-500">
                {fcfa(today.afterSalaries ?? today.revenue - today.salaries)} après {fcfa(today.salaries)} de salaires ({today.staffDrivers} livreur(s) salarié(s), part du
                jour)
              </p>
            )}
          </Card>
        )}
        <Card>
          <p className="text-sm text-stone-600">Délai moyen</p>
          <p className="font-display text-2xl font-extrabold tabular-nums">{today.avgDeliveryMinutes != null ? `${today.avgDeliveryMinutes} min` : "–"}</p>
          <p className="text-xs text-stone-500">commande → remise, livrées du jour</p>
        </Card>
        {money && (
          <Card>
            <p className="text-sm text-stone-600">Valeur des commandes</p>
            <p className="font-display text-2xl font-extrabold tabular-nums">{fcfa(today.orderValue)}</p>
            <p className="text-xs text-stone-500">hors annulées</p>
          </Card>
        )}
      </div>

      {money && (
        <Card title="Seuil de rentabilité du jour">
          <div className="relative h-3 rounded-full bg-stone-100">
            <div className={`h-full rounded-full transition-[width] duration-700 ${progress >= 100 ? "bg-emerald-600" : "bg-sun"}`} style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-sm text-stone-600">
            {fcfa(today.revenue)} sur {fcfa(today.breakEven)} ({progress} %)
            {progress >= 100 ? ". Seuil atteint." : ordersLeft !== null ? `. Encore environ ${ordersLeft} commande(s) au rythme du jour.` : "."}
          </p>
        </Card>
      )}

      <Card title="Commandes du jour par statut">
        {totalToday === 0 ? (
          <p className="text-sm text-stone-500">Aucune commande aujourd&apos;hui.</p>
        ) : (
          <>
            <div className="flex h-4 gap-0.5" role="img" aria-label="Répartition des commandes du jour par statut">
              {PIPELINE.filter((p) => data.byStatus[p.status] > 0).map((p) => (
                <span
                  key={p.status}
                  title={`${STATUS_LABEL[p.status]} : ${data.byStatus[p.status]}`}
                  className={`${p.color} rounded`}
                  style={{ flexGrow: data.byStatus[p.status] }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
              {PIPELINE.map((p) => (
                <li key={p.status} className="inline-flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-sm ${p.color}`} />
                  {STATUS_LABEL[p.status]} <strong className="tabular-nums text-stone-900">{data.byStatus[p.status]}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.byHour && (
          <Card title="Commandes par heure">
            <HourChart byHour={data.byHour} />
          </Card>
        )}
        {data.byZone && (
          <Card title="Commandes par zone">
            {data.byZone.length === 0 ? (
              <p className="text-sm text-stone-500">Aucune commande aujourd&apos;hui.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.byZone.map((z, i) => (
                  <li key={z.name} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2">
                    <span className="truncate text-stone-600">{z.name.split(" (")[0]}</span>
                    <span className="h-3 rounded-r-md bg-stone-100">
                      <span className={`block h-full rounded-r-md ${i === 0 ? "bg-emerald-700" : "bg-emerald-400"}`} style={{ width: `${(z.count / zoneMax) * 100}%` }} />
                    </span>
                    <strong className="tabular-nums">{z.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Card
        title="Dernières commandes"
        action={
          <Link href="/admin/commandes" className="text-sm text-emerald-700">
            Tout voir
          </Link>
        }
      >
        {data.recent.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune commande pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {data.recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">
                    {o.code} · {o.type === "PARCEL" ? "Colis" : o.restaurant?.name}
                  </p>
                  <p className="text-stone-500">
                    {new Date(o.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {o.driver?.name ?? "sans livreur"}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={o.status} />
                  <p className="mt-1 tabular-nums">{fcfa(o.total)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
