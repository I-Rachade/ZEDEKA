"use client";

import Link from "next/link";
import { useState } from "react";
import { fcfa } from "@/lib/api";
import { STATUS_LABEL, type AdminOrderStatus } from "@/lib/admin";
import { useI18n, useT } from "@/lib/i18n/client";
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
  live?: {
    enRoute: number;
    kitchen: number;
    toAssign: number;
    late: number;
    freeDrivers: number;
    zedAvailable: number;
  };
  zedToday?: number;
  delays?: { pickupMinutes: number | null; zedAnswerSeconds: number | null };
  todo?: {
    tone: "red" | "orange" | "sun";
    text: string;
    href: string;
    action: string;
  }[];
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
  { status: "PICKED_UP", color: "bg-[#0a6a3f]" },
  { status: "DELIVERED", color: "bg-[#0b4a2e]" },
  { status: "CANCELLED", color: "bg-stone-300" },
];
const OPEN: AdminOrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY"];
const URGENT_MIN = 10;

const minutesSince = (iso: string) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

// Commandes par heure, 7 h – 23 h : barres fines, l'heure la plus chargée en foncé, valeur au survol.
function HourChart({ byHour }: { byHour: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const t = useT();
  const hours = Array.from({ length: 17 }, (_, i) => i + 7);
  const max = Math.max(4, ...hours.map((h) => byHour[h]));
  const peak = Math.max(...hours.map((h) => byHour[h]));
  const W = 340,
    H = 140,
    L = 22,
    B = 18,
    bw = (W - L) / hours.length;
  const y = (v: number) => (H - B) * (1 - v / max);
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible"
        role="img"
        aria-label={t("Commandes par heure aujourd'hui")}
      >
        {[0, Math.round(max / 2), max].map((v) => (
          <g key={v}>
            <line
              x1={L}
              x2={W}
              y1={y(v)}
              y2={y(v)}
              className="stroke-stone-100"
            />
            <text
              x={L - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-stone-400 text-[11px]"
            >
              {v}
            </text>
          </g>
        ))}
        {hours.map((h, i) => {
          const v = byHour[h];
          const x = L + i * bw + 2;
          return (
            <g
              key={h}
              onPointerEnter={() => setHover(h)}
              onPointerLeave={() => setHover(null)}
            >
              <rect
                x={L + i * bw}
                y={0}
                width={bw}
                height={H - B}
                fill="transparent"
              />
              {v > 0 && (
                <rect
                  x={x}
                  y={y(v)}
                  width={bw - 4}
                  height={H - B - y(v)}
                  rx="3"
                  className={
                    v === peak
                      ? "fill-emerald-700"
                      : hover === h
                        ? "fill-emerald-500"
                        : "fill-emerald-400"
                  }
                />
              )}
              {i % 2 === 0 && (
                <text
                  x={x + (bw - 4) / 2}
                  y={H - 4}
                  textAnchor="middle"
                  className="fill-stone-400 text-[11px]"
                >
                  {h}h
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <p className="pointer-events-none absolute right-0 top-0 rounded-md bg-ink-deep px-2 py-1 text-xs text-white">
          {hover} h – {hover + 1} h ·{" "}
          {t(byHour[hover] > 1 ? "{n} commandes" : "{n} commande", {
            n: byHour[hover],
          })}
        </p>
      )}
    </div>
  );
}

function Tile({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone?: "green" | "sun";
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-stone-200 bg-surface px-4 py-3">
      <p
        className={`font-display text-2xl font-extrabold tabular-nums ${tone === "green" ? "text-emerald-700" : tone === "sun" ? "text-amber-700" : ""}`}
      >
        {value}
      </p>
      <p className="text-xs text-stone-500">{t(label)}</p>
    </div>
  );
}

function Mini({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  const t = useT();
  return (
    <div className="rounded-md bg-stone-50 px-3 py-2">
      <p className="text-xs text-stone-500">{t(label)}</p>
      <p
        className={`text-lg font-bold tabular-nums ${alert ? "text-red-600" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const { data, error } = useAdmin<Dashboard>("/dashboard");
  const { t, locale } = useI18n();
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const { today } = data;
  const money = data.money !== false;
  const progress = Math.min(
    100,
    Math.round((today.revenue / today.breakEven) * 100),
  );
  const perOrder = today.orders
    ? (today.revenue - (today.subscriptions ?? 0)) / today.orders
    : 0;
  const ordersLeft =
    today.revenue < today.breakEven && perOrder > 0
      ? Math.ceil((today.breakEven - today.revenue) / perOrder)
      : null;
  const totalToday = PIPELINE.reduce(
    (sum, p) => sum + data.byStatus[p.status],
    0,
  );
  const toHandle = data.recent
    .filter((o) => OPEN.includes(o.status) && !o.driver)
    .map((o) => ({ ...o, age: minutesSince(o.createdAt) }))
    .sort((a, b) => b.age - a.age);
  const zoneMax = Math.max(1, ...(data.byZone ?? []).map((z) => z.count));

  return (
    <div className="space-y-4">
      <PageHeader
        icon="home"
        actions={
          <span className="inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0e7c4a]" />{" "}
            {t("En direct")}
          </span>
        }
        title="Aujourd'hui"
        description={
          money
            ? t(
                "Courses et revenu Zedeka du jour, face au seuil de rentabilité de {amount}.",
                { amount: fcfa(today.breakEven) },
              )
            : t("Courses du jour, à traiter et en cours.")
        }
      />
      {data.pendingDrivers > 0 && (
        <Link
          href="/admin/livreurs"
          className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
        >
          {t("{n} candidature(s) de livreur à examiner", {
            n: data.pendingDrivers,
          })}
        </Link>
      )}

      {/* Planche 9 : compteurs du jour côte à côte, revenu face au seuil. */}
      <div
        className={`grid grid-cols-2 gap-3 ${money ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
      >
        <Tile value={today.orders - today.parcels} label="commandes" />
        <Tile value={today.parcels} label="colis" />
        <Tile value={data.zedToday ?? 0} label="courses Zed" />
        {money && (
          <Tile
            value={fcfa(today.revenue).replace("FCFA", "F")}
            label="revenu Zedeka"
          />
        )}
        {money ? (
          <Tile
            value={`${today.revenue >= today.breakEven ? "✓ " : ""}${fcfa(Math.abs(today.revenue - today.breakEven)).replace("FCFA", "F")}`}
            label={
              today.revenue >= today.breakEven
                ? "seuil dépassé"
                : "avant le seuil"
            }
            tone={today.revenue >= today.breakEven ? "green" : "sun"}
          />
        ) : (
          <Tile
            value={
              today.avgDeliveryMinutes != null
                ? `${today.avgDeliveryMinutes} min`
                : "–"
            }
            label="délai moyen"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {data.live && (
            <Card
              title="Maintenant"
              action={
                <Link
                  href="/admin/dispatch"
                  className="hit text-sm text-emerald-700"
                >
                  {t("Répartition")}
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Mini label="En route" value={data.live.enRoute} />
                <Mini label="En cuisine" value={data.live.kitchen} />
                <Mini
                  label="À affecter"
                  value={data.live.toAssign}
                  alert={data.live.toAssign > 0}
                />
                <Mini
                  label="En retard"
                  value={data.live.late}
                  alert={data.live.late > 0}
                />
                <Mini label="Livreurs libres" value={data.live.freeDrivers} />
                <Mini label="Zed disponibles" value={data.live.zedAvailable} />
              </div>
            </Card>
          )}
          <Card title="À traiter">
            {(data.todo?.length ?? 0) === 0 && toHandle.length === 0 ? (
              <p className="text-sm text-stone-500">
                {t(
                  "Rien en attente : toutes les commandes récentes ont un livreur.",
                )}
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.todo?.map((x, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${x.tone === "red" ? "bg-red-600" : x.tone === "orange" ? "bg-orange-500" : "bg-[#ffb020]"}`}
                      />
                      <span className="truncate">{x.text}</span>
                    </span>
                    {x.href.startsWith("tel:") ? (
                      <a
                        href={x.href}
                        className="shrink-0 font-semibold text-emerald-700"
                      >
                        {t(x.action)}
                      </a>
                    ) : (
                      <Link
                        href={x.href}
                        className="shrink-0 font-semibold text-emerald-700"
                      >
                        {t(x.action)}
                      </Link>
                    )}
                  </li>
                ))}
                {toHandle.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${o.age >= URGENT_MIN ? "bg-red-600" : "bg-[#ffb020]"}`}
                      />
                      <span className="truncate">
                        {o.code} ·{" "}
                        {o.type === "PARCEL" ? t("Colis") : o.restaurant?.name}{" "}
                        · {t("{n} min sans livreur", { n: o.age })}
                      </span>
                    </span>
                    <Link
                      href={`/admin/commandes/${o.id}`}
                      className="shrink-0 font-semibold text-emerald-700"
                    >
                      {t("Voir")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {data.pendingDrivers > 0 && (
            <Link
              href="/admin/livreurs"
              className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
            >
              {t("{n} candidature(s) de livreur à examiner", {
                n: data.pendingDrivers,
              })}
            </Link>
          )}
        </div>
        <div className="space-y-4">
          {data.byHour && (
            <Card title="Commandes par heure">
              <HourChart byHour={data.byHour} />
            </Card>
          )}
          <Card title="Délai moyen">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt>{t("Commande → livrée (repas)")}</dt>
                <dd className="font-bold tabular-nums">
                  {today.avgDeliveryMinutes != null
                    ? `${today.avgDeliveryMinutes} min`
                    : "–"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>{t("Prête → récupérée")}</dt>
                <dd className="font-bold tabular-nums">
                  {data.delays?.pickupMinutes != null
                    ? `${data.delays.pickupMinutes} min`
                    : "–"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>{t("Appel Zed → conducteur")}</dt>
                <dd className="font-bold tabular-nums">
                  {data.delays?.zedAnswerSeconds != null
                    ? `${data.delays.zedAnswerSeconds} s`
                    : "–"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      {money && (
        <Card title="Revenu du jour">
          <div className="relative h-3 rounded-full bg-stone-100">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ${progress >= 100 ? "bg-emerald-600" : "bg-sun"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-stone-600">
            {t("{amount} sur {target} ({pct} %)", {
              amount: fcfa(today.revenue),
              target: fcfa(today.breakEven),
              pct: progress,
            })}
            {progress >= 100
              ? `. ${t("Seuil atteint.")}`
              : ordersLeft !== null
                ? `. ${t("Encore environ {n} commande(s) au rythme du jour.", { n: ordersLeft })}`
                : "."}
          </p>
          <p className="mt-1 text-xs text-stone-500">
            {t("Valeur des commandes")} : {fcfa(today.orderValue)}
            {!!today.subscriptions &&
              ` · ${t("dont {amount} d'abonnements ({n} commerce(s), part du jour)", { amount: fcfa(today.subscriptions), n: today.subscribedRestaurants ?? 0 })}`}
            {!!today.salaries &&
              ` · ${t(
                "{net} après {salaries} de salaires ({n} livreur(s) salarié(s), part du jour)",
                {
                  net: fcfa(
                    today.afterSalaries ?? today.revenue - today.salaries,
                  ),
                  salaries: fcfa(today.salaries),
                  n: today.staffDrivers ?? 0,
                },
              )}`}
          </p>
        </Card>
      )}

      <Card title="Commandes du jour par statut">
        {totalToday === 0 ? (
          <p className="text-sm text-stone-500">
            {t("Aucune commande aujourd'hui.")}
          </p>
        ) : (
          <>
            <div
              className="flex h-4 gap-1"
              role="img"
              aria-label={t("Répartition des commandes du jour par statut")}
            >
              {PIPELINE.filter((p) => data.byStatus[p.status] > 0).map((p) => (
                <span
                  key={p.status}
                  title={`${t(STATUS_LABEL[p.status])} : ${data.byStatus[p.status]}`}
                  className={`${p.color} rounded`}
                  style={{ flexGrow: data.byStatus[p.status] }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
              {PIPELINE.map((p) => (
                <li key={p.status} className="inline-flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-sm ${p.color}`} />
                  {t(STATUS_LABEL[p.status])}{" "}
                  <strong className="tabular-nums text-stone-900">
                    {data.byStatus[p.status]}
                  </strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="grid gap-4">
        {data.byZone && (
          <Card title="Commandes par zone">
            {data.byZone.length === 0 ? (
              <p className="text-sm text-stone-500">
                {t("Aucune commande aujourd'hui.")}
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.byZone.map((z, i) => (
                  <li
                    key={z.name}
                    className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2"
                  >
                    <span className="truncate text-stone-600">
                      {z.name.split(" (")[0]}
                    </span>
                    <span className="h-3 rounded-r-md bg-stone-100">
                      <span
                        className={`block h-full rounded-r-md ${i === 0 ? "bg-[#0a6a3f]" : "bg-emerald-400"}`}
                        style={{ width: `${(z.count / zoneMax) * 100}%` }}
                      />
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
          <Link href="/admin/commandes" className="hit text-sm text-emerald-700">
            {t("Tout voir")}
          </Link>
        }
      >
        {data.recent.length === 0 ? (
          <p className="text-sm text-stone-500">
            {t("Aucune commande pour l'instant.")}
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {data.recent.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-2 py-2"
              >
                <div>
                  <p className="font-medium">
                    {o.code} ·{" "}
                    {o.type === "PARCEL" ? t("Colis") : o.restaurant?.name}
                  </p>
                  <p className="text-stone-500">
                    {new Date(o.createdAt).toLocaleTimeString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {o.driver?.name ?? t("sans livreur")}
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
