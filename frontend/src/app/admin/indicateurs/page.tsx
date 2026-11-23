"use client";

import Link from "next/link";
import { useState } from "react";
import { fcfa } from "@/lib/api";
import { ColumnChart, KpiTile, SERIES_COLORS, Trend } from "@/components/panel/charts";
import { useI18n } from "@/lib/i18n/client";
import { Card, ErrorNote, Loading, PageHeader } from "../ui";
import { useAdmin } from "../useAdmin";

type Service = "food" | "parcel" | "ride" | "shop" | "service";
type Kpis = {
  orders: number;
  ordersPerDay: number;
  byService: Record<Service, number>;
  completed: number;
  cancelled: number;
  cancellationRate: number | null;
  cancellationByService: Record<Service, number | null>;
  cancellationReasons: { reason: string; count: number }[];
  acceptanceRate: number | null;
  rideAcceptanceRate: number | null;
  serviceAcceptanceRate: number | null;
  stages: Record<"accept" | "prepare" | "waitDriver" | "deliverFood" | "parcelPickup" | "deliverParcel" | "rideAccept" | "serviceAccept", number | null>;
  deliveryMinutes: { median: number | null; p90: number | null; avg: number | null };
  avgBasket: number | null;
  avgOrderValue: number | null;
  gmv: number;
  revenue: number;
  revenuePerDay: number;
  revenueByService: Record<Service, { gmv: number; zedeka: number | null }>;
  activeCustomers: number;
  activeDrivers: number;
  deliveriesPerDriverPerDay: number | null;
  newCustomers: number;
};
type Report = {
  days: number;
  from: string;
  to: string;
  previousFrom: string;
  current: Kpis & { returningCustomers: number; retentionRate: number | null };
  previous: Kpis;
  series: ({ date: string; cancelled: number; revenue: number } & Record<Service, number>)[];
  now: {
    driversOnline: number;
    driversApproved: number;
    restaurants: number;
    subscribedRestaurants: number;
    proRestaurants: number;
    commissionRestaurants: number;
    onlineShops: number;
    subscribedShops: number;
    monthlySubscriptions: number;
  };
};

const PERIODS = [
  { days: 1, label: "Aujourd'hui" },
  { days: 7, label: "7 jours" },
  { days: 30, label: "30 jours" },
  { days: 90, label: "90 jours" },
];

// Ordre fixe des services, couleurs fixes (jamais selon le rang).
const SERVICES: { key: Service; label: string }[] = [
  { key: "food", label: "Repas" },
  { key: "parcel", label: "Colis" },
  { key: "ride", label: "Courses Zed" },
  { key: "shop", label: "Boutiques" },
  { key: "service", label: "Services" },
];
const SERIES = SERVICES.map((s, i) => ({ ...s, color: SERIES_COLORS[i] }));

const STAGES: { key: keyof Kpis["stages"]; label: string }[] = [
  { key: "accept", label: "Acceptation par le commerce" },
  { key: "prepare", label: "Préparation" },
  { key: "waitDriver", label: "Attente du livreur" },
  { key: "deliverFood", label: "Trajet jusqu'au client (repas)" },
  { key: "parcelPickup", label: "Prise en charge d'un colis" },
  { key: "deliverParcel", label: "Trajet d'un colis" },
  { key: "rideAccept", label: "Prise d'une course Zed" },
  { key: "serviceAccept", label: "Prise d'une demande de service" },
];

const mins = (v: number | null) => (v === null ? "–" : `${Math.round(v)} min`);
const pct = (v: number | null) => (v === null ? "–" : `${v.toLocaleString()} %`);

// Indicateurs clés du métier : volume, qualité de service, clients, revenus et partenaires, comparés à la période
// précédente de même durée.
export default function KpiPage() {
  const [days, setDays] = useState(7);
  const { t, locale } = useI18n();
  const { data, error } = useAdmin<Report>(`/kpi?days=${days}`);
  const c = data?.current;
  const p = data?.previous;
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });

  return (
    <div className="space-y-4">
      <PageHeader
        icon="chart"
        title="Indicateurs (KPI)"
        description="Volume, qualité de service, clients, revenus et partenaires, comparés à la période précédente de même durée."
        actions={
          <Link href="/admin/performance" className="text-sm font-medium text-emerald-700 underline">
            {t("Performance de l'appli")}
          </Link>
        }
      />
      <div className="flex flex-wrap gap-1 text-sm">
        {PERIODS.map((x) => (
          <button key={x.days} onClick={() => setDays(x.days)} className={`rounded-full px-3 py-1 ${days === x.days ? "bg-night-soft text-white" : "bg-surface"}`}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <ErrorNote message={data ? null : error} />
      {!data || !c || !p ? (
        !error && <Loading />
      ) : (
        <>
          <p className="text-xs text-stone-500">
            {t("Comparé au {from} → {to}.", { from: day(data.previousFrom), to: day(data.from) })}
          </p>

          <h2 className="pt-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{t("Activité")}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Commandes et courses" value={c.orders.toLocaleString(locale)} now={c.orders} before={p.orders} hint={t("{n} par jour", { n: c.ordersPerDay.toLocaleString(locale) })} />
            <KpiTile label="Terminées" value={c.completed.toLocaleString(locale)} now={c.completed} before={p.completed} />
            <KpiTile label="Taux d'annulation" value={pct(c.cancellationRate)} now={c.cancellationRate} before={p.cancellationRate} better="down" unit="pts" hint={t("{n} annulée(s)", { n: c.cancelled })} />
            <KpiTile label="Acceptation par les commerces" value={pct(c.acceptanceRate)} now={c.acceptanceRate} before={p.acceptanceRate} unit="pts" />
          </div>

          <Card title="Commandes par jour et par service" icon="chart">
            <ColumnChart rows={data.series} series={SERIES} labelOf={(r) => day(r.date)} />
          </Card>

          <h2 className="pt-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{t("Qualité de service")}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Temps de livraison" value={mins(c.deliveryMinutes.median)} now={c.deliveryMinutes.median} before={p.deliveryMinutes.median} better="down" hint="médiane, commande → livrée" />
            <KpiTile label="Livraisons les plus lentes" value={mins(c.deliveryMinutes.p90)} now={c.deliveryMinutes.p90} before={p.deliveryMinutes.p90} better="down" hint="9 sur 10 livrées avant" />
            <KpiTile label="Courses Zed prises" value={pct(c.rideAcceptanceRate)} now={c.rideAcceptanceRate} before={p.rideAcceptanceRate} unit="pts" />
            <KpiTile label="Demandes de services prises" value={pct(c.serviceAcceptanceRate)} now={c.serviceAcceptanceRate} before={p.serviceAcceptanceRate} unit="pts" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Délais par étape (médiane)" icon="clock">
              <dl className="divide-y divide-stone-100 text-sm">
                {STAGES.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-stone-600">{t(s.label)}</dt>
                    <dd className="flex items-center gap-2 font-semibold">
                      <Trend now={c.stages[s.key]} before={p.stages[s.key]} better="down" />
                      {mins(c.stages[s.key])}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card title="Annulations" icon="close">
              <dl className="divide-y divide-stone-100 text-sm">
                {SERVICES.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-stone-600">{t(s.label)}</dt>
                    <dd className="font-semibold">{pct(c.cancellationByService[s.key])}</dd>
                  </div>
                ))}
              </dl>
              {c.cancellationReasons.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-semibold text-stone-500">{t("Motifs les plus fréquents")}</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {c.cancellationReasons.map((r) => (
                      <li key={r.reason} className="flex justify-between gap-3">
                        <span className="text-stone-600">{r.reason === "Sans motif" ? t("Sans motif") : r.reason}</span>
                        <span className="font-semibold">{r.count}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <h2 className="pt-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{t("Clients")}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Clients actifs" value={c.activeCustomers.toLocaleString(locale)} now={c.activeCustomers} before={p.activeCustomers} hint="au moins une commande" />
            <KpiTile label="Nouveaux clients" value={c.newCustomers.toLocaleString(locale)} now={c.newCustomers} before={p.newCustomers} hint="comptes créés" />
            <KpiTile label="Fidélité" value={pct(c.retentionRate)} hint="clients de la période précédente revenus" />
            <KpiTile label="Panier moyen" value={c.avgBasket === null ? "–" : fcfa(c.avgBasket)} now={c.avgBasket} before={p.avgBasket} hint="repas et boutiques, hors livraison" />
          </div>

          <h2 className="pt-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{t("Revenus")}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Chiffre d'affaires" value={fcfa(c.gmv)} now={c.gmv} before={p.gmv} hint="payé par les clients" />
            <KpiTile label="Revenu Zedeka" value={fcfa(c.revenue)} now={c.revenue} before={p.revenue} hint={t("{amount} par jour", { amount: fcfa(c.revenuePerDay) })} />
            <KpiTile label="Valeur moyenne d'une commande" value={c.avgOrderValue === null ? "–" : fcfa(c.avgOrderValue)} now={c.avgOrderValue} before={p.avgOrderValue} />
            <KpiTile label="Abonnements par mois" value={fcfa(data.now.monthlySubscriptions)} hint={t("{n} commerce(s) et {m} boutique(s)", { n: data.now.subscribedRestaurants, m: data.now.subscribedShops })} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Revenus par service" icon="wallet">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="py-1 font-medium">{t("Service")}</th>
                    <th className="py-1 text-right font-medium">{t("Commandes")}</th>
                    <th className="py-1 text-right font-medium">{t("Chiffre d'affaires")}</th>
                    <th className="py-1 text-right font-medium">{t("Revenu Zedeka")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {SERIES.map((s) => (
                    <tr key={s.key}>
                      <td className="py-1.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                          {t(s.label)}
                        </span>
                      </td>
                      <td className="py-1.5 text-right">{c.byService[s.key]}</td>
                      <td className="py-1.5 text-right">{fcfa(c.revenueByService[s.key].gmv)}</td>
                      <td className="py-1.5 text-right">{c.revenueByService[s.key].zedeka === null ? "–" : fcfa(c.revenueByService[s.key].zedeka!)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-stone-500">{t("Revenu Zedeka : frais et commissions, moins remises et part des livreurs. Zed et services : montant payé au prestataire, sans part Zedeka enregistrée.")}</p>
            </Card>
            <Card title="Revenu Zedeka par jour" icon="chart">
              <ColumnChart rows={data.series} series={[{ key: "revenue", label: "Revenu Zedeka", color: SERIES_COLORS[0] }]} labelOf={(r) => day(r.date)} format={fcfa} />
            </Card>
          </div>

          <h2 className="pt-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{t("Livreurs et partenaires")}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Livreurs en ligne" value={data.now.driversOnline} hint={t("en ce moment, sur {n} validés", { n: data.now.driversApproved })} />
            <KpiTile label="Livreurs actifs" value={c.activeDrivers} now={c.activeDrivers} before={p.activeDrivers} hint="au moins une course terminée" />
            <KpiTile label="Courses par livreur et par jour" value={c.deliveriesPerDriverPerDay === null ? "–" : c.deliveriesPerDriverPerDay.toLocaleString(locale)} now={c.deliveriesPerDriverPerDay} before={p.deliveriesPerDriverPerDay} />
            <KpiTile
              label="Commerces actifs"
              value={data.now.restaurants}
              hint={t("{s} abonnés (dont {p} Pro), {c} à la commission, {b} boutiques en ligne", { s: data.now.subscribedRestaurants, p: data.now.proRestaurants, c: data.now.commissionRestaurants, b: data.now.onlineShops })}
            />
          </div>
        </>
      )}
    </div>
  );
}
