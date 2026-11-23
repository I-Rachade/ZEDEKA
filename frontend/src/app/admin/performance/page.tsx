"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ColumnChart, KpiTile, SERIES_COLORS } from "@/components/panel/charts";
import { useI18n } from "@/lib/i18n/client";
import { Card, ErrorNote, Loading, PageHeader } from "../ui";
import { useAdmin } from "../useAdmin";

type Summary = {
  requests: number;
  errors: number;
  clientErrors: number;
  errorRate: number | null;
  avgMs: number | null;
  p50: number | null;
  p95: number | null;
  maxMs: number;
  fastRate: number | null;
};
type Uptime = { rate: number | null; okMinutes: number; expectedMinutes: number; dbAvgMs: number | null };
type RouteRow = Summary & { route: string };
type Vital = { page: string; visits: number; LCP: number | null; FCP: number | null; TTFB: number | null; INP: number | null; CLS: number | null };
type Perf = {
  hours: number;
  current: Summary & { availability: Uptime };
  previous: Summary & { availability: Uptime };
  series: { at: string; requests: number; errors: number; p95: number | null }[];
  busiest: RouteRow[];
  slowest: RouteRow[];
  failing: RouteRow[];
  vitals: Vital[];
};

const PERIODS = [
  { hours: 1, label: "1 heure" },
  { hours: 24, label: "24 heures" },
  { hours: 168, label: "7 jours" },
];

// Seuils Google des Core Web Vitals : bon, puis à améliorer ; au-delà, mauvais.
const VITAL_LIMITS = { LCP: [2500, 4000], FCP: [1800, 3000], TTFB: [800, 1800], INP: [200, 500], CLS: [0.1, 0.25] } as const;
type VitalName = keyof typeof VITAL_LIMITS;
const vitalLevel = (name: VitalName, v: number | null) => (v === null ? null : v <= VITAL_LIMITS[name][0] ? 0 : v <= VITAL_LIMITS[name][1] ? 1 : 2);
const VITAL_TONE = ["text-emerald-700", "text-amber-700", "text-red-700"];
const VITAL_MARK = ["", " ·", " !"];
const vitalText = (name: VitalName, v: number | null) => (v === null ? "–" : name === "CLS" ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const ms = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const pct = (v: number | null) => (v === null ? "–" : `${v} %`);

// Performance de l'appli : temps de réponse et erreurs de l'API mesurés par le serveur, disponibilité (battement du
// cron chaque minute) et vitesse des pages vue par les téléphones. Les alertes partent dans le fil « Technique ».
export default function PerformancePage() {
  const [hours, setHours] = useState(24);
  const { t, locale } = useI18n();
  const { data, error, reload } = useAdmin<Perf>(`/perf?hours=${hours}`);

  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  const c = data?.current;
  const p = data?.previous;
  const at = (iso: string) =>
    hours >= 24
      ? new Date(iso).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" })
      : new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const status =
    !c || c.requests === 0
      ? null
      : (c.errorRate ?? 0) >= 5 || (c.p95 ?? 0) > 3000 || (c.availability.rate ?? 100) < 99
        ? { label: "À surveiller", tone: "bg-amber-100 text-amber-900", dot: "bg-amber-500" }
        : { label: "Tout va bien", tone: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-600" };

  return (
    <div className="space-y-4">
      <PageHeader
        icon="shield"
        title="Performance de l'appli"
        description="Temps de réponse et erreurs de l'API, disponibilité et vitesse des pages sur les téléphones. Mis à jour chaque minute."
        actions={
          <>
            {status && (
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${status.tone}`}>
                <span className={`h-2 w-2 rounded-full ${status.dot}`} /> {t(status.label)}
              </span>
            )}
            <Link href="/admin/indicateurs" className="text-sm font-medium text-emerald-700 underline">
              {t("Indicateurs (KPI)")}
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap gap-1 text-sm">
        {PERIODS.map((x) => (
          <button key={x.hours} onClick={() => setHours(x.hours)} className={`rounded-full px-3 py-1 ${hours === x.hours ? "bg-night-soft text-white" : "bg-surface"}`}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <ErrorNote message={data ? null : error} />
      {!data || !c || !p ? (
        !error && <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label="Disponibilité"
              value={pct(c.availability.rate)}
              now={c.availability.rate}
              before={p.availability.rate}
              unit="pts"
              hint={c.availability.expectedMinutes ? t("{ok} min sur {n}", { ok: c.availability.okMinutes, n: c.availability.expectedMinutes }) : "pas encore de mesure"}
            />
            <KpiTile label="Temps de réponse (95 %)" value={ms(c.p95)} now={c.p95} before={p.p95} better="down" hint={t("médiane {m}", { m: ms(c.p50) })} />
            <KpiTile label="Erreurs du serveur" value={pct(c.errorRate)} now={c.errorRate} before={p.errorRate} better="down" unit="pts" hint={t("{n} sur {total} requêtes", { n: c.errors, total: c.requests.toLocaleString(locale) })} />
            <KpiTile label="Base de données" value={ms(c.availability.dbAvgMs)} now={c.availability.dbAvgMs} before={p.availability.dbAvgMs} better="down" hint="temps moyen, vu par le serveur" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Requêtes" value={c.requests.toLocaleString(locale)} now={c.requests} before={p.requests} />
            <KpiTile label="Réponses en moins de 0,5 s" value={pct(c.fastRate)} now={c.fastRate} before={p.fastRate} unit="pts" />
            <KpiTile label="Temps moyen" value={ms(c.avgMs)} now={c.avgMs} before={p.avgMs} better="down" hint={t("plus long : {m}", { m: ms(c.maxMs) })} />
            <KpiTile label="Refus et introuvables" value={c.clientErrors.toLocaleString(locale)} hint="réponses 4xx (code faux, page absente…)" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Requêtes et erreurs" icon="chart">
              <ColumnChart
                rows={data.series.map((s) => ({ ...s, ok: s.requests - s.errors }))}
                series={[
                  { key: "ok", label: "Réussies", color: SERIES_COLORS[1] },
                  { key: "errors", label: "Erreurs du serveur", color: "#dc2626" },
                ]}
                labelOf={(r) => at(r.at)}
                format={(v) => v.toLocaleString(locale)}
              />
            </Card>
            <Card title="Temps de réponse (95 % des requêtes)" icon="clock">
              <ColumnChart rows={data.series.map((s) => ({ ...s, p95: s.p95 ?? 0 }))} series={[{ key: "p95", label: "Temps de réponse", color: SERIES_COLORS[2] }]} labelOf={(r) => at(r.at)} format={(v) => ms(v)} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RouteTable title="Routes les plus lentes" rows={data.slowest} metric={(r) => ms(r.p95)} metricLabel="95 %" />
            <RouteTable title="Routes en erreur" rows={data.failing} metric={(r) => `${r.errors} (${pct(r.errorRate)})`} metricLabel="Erreurs" empty="Aucune erreur du serveur sur la période." />
          </div>
          <RouteTable title="Routes les plus demandées" rows={data.busiest} metric={(r) => r.requests.toLocaleString(locale)} metricLabel="Requêtes" />

          <Card title="Vitesse vue par les téléphones (7 jours)" icon="clock">
            {data.vitals.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-stone-500">
                      <th className="py-1 pr-3 font-medium">{t("Page")}</th>
                      <th className="py-1 pr-3 font-medium">{t("Visites")}</th>
                      {(["TTFB", "FCP", "LCP", "INP", "CLS"] as const).map((n) => (
                        <th key={n} className="py-1 pr-3 font-medium">
                          {n}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data.vitals.map((v) => (
                      <tr key={v.page}>
                        <td className="py-1.5 pr-3 font-mono text-xs">{v.page}</td>
                        <td className="py-1.5 pr-3">{v.visits}</td>
                        {(["TTFB", "FCP", "LCP", "INP", "CLS"] as const).map((n) => {
                          const level = vitalLevel(n, v[n]);
                          return (
                            <td key={n} className={`py-1.5 pr-3 font-semibold ${level === null ? "text-stone-400" : VITAL_TONE[level]}`}>
                              {vitalText(n, v[n])}
                              {level !== null && VITAL_MARK[level]}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-stone-500">
                  {t("Valeur que 3 visites sur 4 ne dépassent pas. Vert : bon ; orange (·) : à améliorer ; rouge (!) : lent.")}{" "}
                  {t("TTFB : première réponse ; FCP : premier affichage ; LCP : page affichée ; INP : réactivité ; CLS : stabilité.")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-stone-500">{t("Pas encore de mesure : elles arrivent avec les visites.")}</p>
            )}
          </Card>
          <p className="text-xs text-stone-500">
            {t("Alertes automatiques (fil des notifications, « Technique ») : erreurs du serveur au-delà de 5 %, réponses au-delà de 3 s, base lente. Journaux détaillés : tableau de bord Cloudflare, Workers > zedeka-api > Observability.")}
          </p>
        </>
      )}
    </div>
  );
}

function RouteTable({ title, rows, metric, metricLabel, empty = "Pas encore de mesure sur la période." }: { title: string; rows: RouteRow[]; metric: (r: RouteRow) => string; metricLabel: string; empty?: string }) {
  const { t } = useI18n();
  return (
    <Card title={title} icon="sliders">
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">{t(empty)}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="py-1 font-medium">{t("Route")}</th>
              <th className="py-1 text-right font-medium">{t(metricLabel)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.route}>
                <td className="break-all py-1.5 pr-3 font-mono text-xs">{r.route}</td>
                <td className="whitespace-nowrap py-1.5 text-right font-semibold">{metric(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
