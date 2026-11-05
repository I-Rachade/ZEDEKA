"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorNote, Loading } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import type { Me, RestaurantOrder } from "@/lib/restaurant";
import { useOnNewOrder } from "./useNewOrders";
import { useRestaurant } from "./useRestaurant";
import { useT } from "@/lib/i18n/client";

// Tableau de bord du restaurant (planche 9) : compteurs du jour, « En ce moment » avec un chrono par commande et
// l'arrivée du livreur, ventes des 7 jours, plats les plus vendus et coût des promos payées par le restaurant.

type Dashboard = {
  byStatus: Record<string, number>;
  today: { orders: number; sales: number; net: number };
  week: { orders: number; sales: number; net: number };
  days: { date: string; sales: number }[];
  prepMinutes: number | null;
  rating: { average: number | null; count: number };
  topItems: { name: string; quantity: number }[];
  promos: { code: string; uses: number; cost: number }[];
};

const DAY = ["D", "L", "M", "M", "J", "V", "S"];
const STEP: Record<string, string> = {
  PENDING: "Nouvelle",
  CONFIRMED: "Acceptée",
  PREPARING: "En cuisine",
  READY: "Prête",
};
const short = (n: number) => fcfa(n).replace("FCFA", "F");
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Counter({ value, label }: { value: string | number; label: string }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-xs text-stone-500">{t(label)}</p>
    </div>
  );
}

function Box({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <section
      className={`rounded-lg border border-stone-200 bg-white p-4 ${className}`}
    >
      <h2 className="mb-3 font-bold">{t(title)}</h2>
      {children}
    </section>
  );
}

function Chrono({ o, now }: { o: RestaurantOrder; now: number }) {
  const cooking = o.status === "CONFIRMED" || o.status === "PREPARING";
  const start = cooking
    ? (o.preparingAt ?? o.confirmedAt)
    : o.status === "READY"
      ? o.readyAt
      : o.createdAt;
  const elapsed = start ? now - new Date(start).getTime() : 0;
  const late = cooking && !!o.prepMinutes && elapsed > o.prepMinutes * 60_000;
  const tone = late
    ? "bg-red-50 text-red-700"
    : cooking
      ? "bg-emerald-50 text-emerald-800"
      : o.status === "READY"
        ? "bg-stone-100 text-stone-600"
        : "bg-amber-50 text-amber-800";
  const dot = late
    ? "bg-red-600"
    : cooking
      ? "bg-[#0e7c4a]"
      : o.status === "READY"
        ? "bg-stone-400"
        : "bg-[#ffb020]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {clock(elapsed)}
      {cooking && o.prepMinutes ? ` / ${o.prepMinutes}` : ""}
    </span>
  );
}

function driverText(o: RestaurantOrder, t: ReturnType<typeof useT>) {
  if (
    o.status === "PENDING" ||
    o.tableNumber != null ||
    o.fulfillment === "PICKUP"
  )
    return "—";
  if (!o.driver) return t("pas encore affecté");
  const first = o.driver.name.split(" ")[0];
  if (o.driver.atRestaurant) return t("{name} attend", { name: first });
  return o.driver.etaMin != null
    ? t("{name} dans {n} min", { name: first, n: o.driver.etaMin })
    : first;
}

export default function RestaurantDashboard() {
  const me = useRestaurant<Me>("/me");
  const stats = useRestaurant<Dashboard>("/dashboard");
  const live = useRestaurant<RestaurantOrder[]>("/orders?active=1");
  const now = useNow();
  const t = useT();
  const { reload: reloadStats } = stats;
  const { reload: reloadLive } = live;
  useOnNewOrder(
    useCallback(() => (reloadStats(), reloadLive()), [reloadStats, reloadLive]),
  );
  useEffect(() => {
    const id = setInterval(reloadLive, 20_000);
    return () => clearInterval(id);
  }, [reloadLive]);

  if (stats.error || me.error)
    return <ErrorNote message={stats.error ?? me.error} />;
  if (!stats.data || !me.data) return <Loading />;
  const d = stats.data;
  const open = me.data.availability.open;
  const max = Math.max(1, ...d.days.map((x) => x.sales));
  const greet =
    me.data.account?.role === "OWNER"
      ? me.data.name
      : (me.data.account?.name ?? me.data.name);
  // Les retards d'abord, puis les nouvelles, la cuisine et les prêtes.
  const order = { PENDING: 1, CONFIRMED: 2, PREPARING: 2, READY: 3 } as Record<
    string,
    number
  >;
  const rows = [...(live.data ?? [])]
    .sort(
      (a, b) =>
        (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">
          {t("Bonjour {name}", { name: greet.split(" ")[0] })}
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/restaurant/caisse"
            className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-stone-50"
          >
            {t("Mode caisse")}
          </Link>
          <Link
            href="/restaurant/reglages"
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${open ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${open ? "bg-[#0e7c4a]" : "bg-[#ffb020]"}`}
            />
            {open
              ? t("Ouvert")
              : t("Fermé : {reason}", {
                  reason: me.data.availability.reason ?? "",
                })}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Counter value={short(d.today.sales)} label="ventes du jour" />
        <Counter value={d.today.orders} label="commandes" />
        <Counter
          value={d.prepMinutes != null ? `${d.prepMinutes} min` : "—"}
          label="préparation moyenne"
        />
        <Counter
          value={
            d.rating.average != null
              ? `★ ${d.rating.average.toLocaleString("fr-FR")}`
              : "—"
          }
          label={t("{n} avis", { n: d.rating.count })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Box title="En ce moment" className="self-start">
          {!live.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">
              {t("Aucune commande en cours.")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 text-left text-xs text-stone-500">
                  <th className="rounded-l-md px-2 py-2 font-medium">
                    {t("Commande")}
                  </th>
                  <th className="px-2 py-2 font-medium">{t("Étape")}</th>
                  <th className="px-2 py-2 font-medium">{t("Chrono")}</th>
                  <th className="rounded-r-md px-2 py-2 font-medium">
                    {t("Livreur")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-stone-100 last:border-0"
                  >
                    <td className="px-2 py-2.5 font-bold">
                      <Link
                        href={`/restaurant/commandes/${o.id}`}
                        className="hover:underline"
                      >
                        {o.code}
                      </Link>
                    </td>
                    <td className="px-2 py-2.5">
                      {t(STEP[o.status] ?? o.status)}
                    </td>
                    <td className="px-2 py-2.5">
                      <Chrono o={o} now={now} />
                    </td>
                    <td className="px-2 py-2.5 text-stone-600">
                      {driverText(o, t)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link
            href="/restaurant/commandes"
            className="mt-3 inline-block text-sm font-semibold text-[#0e7c4a]"
          >
            {t("Ouvrir les commandes")} ›
          </Link>
        </Box>

        <div className="space-y-4">
          <Box title="Ventes · 7 jours">
            <div
              className="flex h-28 items-end gap-2"
              role="img"
              aria-label={t("Ventes des 7 derniers jours")}
            >
              {d.days.map((x, i) => (
                <div
                  key={x.date}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <div
                    title={short(x.sales)}
                    className={`w-full rounded-t-sm ${i === d.days.length - 1 ? "bg-emerald-200" : "bg-[#0e7c4a]"}`}
                    style={{ height: `${Math.max(3, (x.sales / max) * 96)}px` }}
                  />
                  <span className="text-[10px] text-stone-500">
                    {DAY[new Date(`${x.date}T12:00:00Z`).getUTCDay()]}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-500">
              {t("{amount} sur 7 jours · {n} commande(s)", {
                amount: short(d.week.sales),
                n: d.week.orders,
              })}
            </p>
          </Box>
          <Box title="Plats les plus vendus">
            {d.topItems.length === 0 ? (
              <p className="text-sm text-stone-500">
                {t("Pas encore de ventes ce mois-ci.")}
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {d.topItems.map((x) => (
                  <li key={x.name} className="flex justify-between gap-2">
                    <span>{x.name}</span>
                    <span className="font-bold tabular-nums">{x.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </Box>
          {d.promos.map((p) => (
            <p
              key={p.code}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              🏷️{" "}
              {t(
                "Promo {code} · {n} utilisation(s) · payée par vous : {amount}",
                { code: p.code, n: p.uses, amount: short(p.cost) },
              )}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
