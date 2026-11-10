"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Card, ErrorNote, Loading, PageHeader, StatTile } from "../ui";
import { useAdmin } from "../useAdmin";

type Health = {
  checkedAt: string;
  db: { ok: boolean; ms: number };
  today: { orders: number; parcels: number; rides: number };
  last: Record<"order" | "parcel" | "ride" | "driver" | "customer" | "restaurant" | "staff", string | null>;
  field: { driversOnline: number; driversOnlineNoSignal: number; driversBusyNoSignal: number; ordersLate: number; pushDevices: number; alerts24h: number };
  // Vitesse vue par les téléphones, 7 derniers jours : 75e centile par page (ms ; CLS sans unité).
  vitals?: { page: string; visits: number; LCP: number | null; FCP: number | null; TTFB: number | null; INP: number | null; CLS: number | null }[];
};

// Seuils Google des Core Web Vitals : bon, puis à améliorer ; au-delà, mauvais.
const VITAL_LIMITS = { LCP: [2500, 4000], FCP: [1800, 3000], TTFB: [800, 1800], INP: [200, 500], CLS: [0.1, 0.25] } as const;
type VitalName = keyof typeof VITAL_LIMITS;
const vitalTone = (name: VitalName, v: number | null) =>
  v === null ? "text-stone-400" : v <= VITAL_LIMITS[name][0] ? "text-emerald-700" : v <= VITAL_LIMITS[name][1] ? "text-amber-700" : "text-red-700";
const vitalText = (name: VitalName, v: number | null) => (v === null ? "–" : name === "CLS" ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

const LAST: { key: keyof Health["last"]; label: string }[] = [
  { key: "order", label: "Dernière commande de repas" },
  { key: "parcel", label: "Dernier colis" },
  { key: "ride", label: "Dernière course Zed" },
  { key: "driver", label: "Dernier signal d'un livreur" },
  { key: "customer", label: "Dernière connexion d'un client" },
  { key: "restaurant", label: "Dernière connexion d'un restaurant" },
  { key: "staff", label: "Dernière connexion de l'équipe" },
];

// Santé de la plateforme : la base répond-elle, combien de temps met une réponse jusqu'ici,
// quand chaque appli a servi pour la dernière fois, et ce qui cloche sur le terrain.
export default function HealthPage() {
  const t = useT();
  const { data, error, reload, savedAt } = useAdmin<Health>("/health");
  // Aller-retour mesuré depuis ce navigateur (réseau + serveur + base).
  const [rtt, setRtt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const measure = useCallback(async () => {
    const t0 = performance.now();
    await reload();
    setRtt(Math.round(performance.now() - t0));
    setNow(Date.now());
  }, [reload]);

  useEffect(() => {
    measure();
    const timer = setInterval(measure, 30_000);
    return () => clearInterval(timer);
  }, [measure]);

  const ago = (iso: string | null) => {
    if (!iso) return t("jamais");
    const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
    if (min < 1) return t("à l'instant");
    if (min < 60) return t("il y a {n} min", { n: min });
    if (min < 48 * 60) return t("il y a {n} h", { n: Math.round(min / 60) });
    return t("il y a {n} j", { n: Math.round(min / 1440) });
  };

  const f = data?.field;
  const offline = savedAt != null || (!!error && !data);
  const watch = !!f && (f.driversBusyNoSignal > 0 || f.ordersLate > 0 || (data?.db.ms ?? 0) > 1000);
  const status = offline
    ? { label: "Serveur injoignable", tone: "bg-red-100 text-red-800", dot: "bg-red-600" }
    : watch
      ? { label: "À surveiller", tone: "bg-amber-100 text-amber-900", dot: "bg-amber-500" }
      : { label: "Tout va bien", tone: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-600" };

  return (
    <div className="space-y-4">
      <PageHeader
        icon="shield"
        title="Santé de la plateforme"
        description="Le serveur et la base répondent-ils, quand chaque appli a servi pour la dernière fois, et ce qui cloche sur le terrain. Mis à jour toutes les 30 secondes."
        actions={
          data && (
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${status.tone}`}>
              <span className={`h-2 w-2 rounded-full ${status.dot}`} /> {t(status.label)}
            </span>
          )
        }
      />
      <ErrorNote message={data ? null : error} />
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Réponse jusqu'ici" value={rtt != null ? `${rtt} ms` : "…"} hint="réseau, serveur et base" />
            <StatTile label="Base de données" value={`${data.db.ms} ms`} hint={data.db.ms > 1000 ? "lente" : "répond"} />
            <StatTile label="Commandes de repas" value={data.today.orders} hint="aujourd'hui" />
            <StatTile label="Colis" value={data.today.parcels} hint="aujourd'hui" />
            <StatTile label="Courses Zed" value={data.today.rides} hint="aujourd'hui" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Terrain" icon="rider">
              <dl className="divide-y divide-stone-100 text-sm">
                <Row label={t("Livreurs en ligne avec signal")} value={f!.driversOnline} />
                <Row label={t("Livreurs en course sans signal depuis 5 min")} value={f!.driversBusyNoSignal} alert={f!.driversBusyNoSignal > 0} />
                <Row label={t("Livreurs « en ligne » sans signal depuis 5 min")} value={f!.driversOnlineNoSignal} warn={f!.driversOnlineNoSignal > 0} />
                <Row label={t("Commandes ouvertes depuis plus de 1 h 30")} value={f!.ordersLate} alert={f!.ordersLate > 0} />
                <Row label={t("Appareils abonnés aux notifications")} value={f!.pushDevices} />
                <Row label={t("Alertes envoyées à l'équipe (24 h)")} value={f!.alerts24h} />
              </dl>
            </Card>
            <Card title="Dernière activité" icon="clock">
              <dl className="divide-y divide-stone-100 text-sm">
                {LAST.map((l) => (
                  <Row key={l.key} label={t(l.label)} value={ago(data.last[l.key])} />
                ))}
              </dl>
            </Card>
          </div>
          <Card title="Vitesse vue par les téléphones (7 jours)" icon="clock">
            {data.vitals?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-stone-500">
                      <th className="py-1 pr-3 font-medium">{t("Page")}</th>
                      <th className="py-1 pr-3 font-medium">{t("Visites")}</th>
                      <th className="py-1 pr-3 font-medium" title={t("Temps de première réponse")}>TTFB</th>
                      <th className="py-1 pr-3 font-medium" title={t("Premier affichage")}>FCP</th>
                      <th className="py-1 pr-3 font-medium" title={t("Plus grand élément affiché")}>LCP</th>
                      <th className="py-1 pr-3 font-medium" title={t("Réactivité aux gestes")}>INP</th>
                      <th className="py-1 font-medium" title={t("Stabilité de la page")}>CLS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data.vitals.map((v) => (
                      <tr key={v.page}>
                        <td className="py-1.5 pr-3 font-mono text-xs">{v.page}</td>
                        <td className="py-1.5 pr-3">{v.visits}</td>
                        {(["TTFB", "FCP", "LCP", "INP", "CLS"] as const).map((n) => (
                          <td key={n} className={`py-1.5 pr-3 font-semibold ${vitalTone(n, v[n])}`}>
                            {vitalText(n, v[n])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-stone-500">{t("Valeur que 3 visites sur 4 ne dépassent pas. Vert : bon ; orange : à améliorer ; rouge : lent.")}</p>
              </div>
            ) : (
              <p className="text-sm text-stone-500">{t("Pas encore de mesure : elles arrivent avec les visites.")}</p>
            )}
          </Card>
          <p className="text-xs text-stone-500">
            {t("Vérifié à {time}.", { time: new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}{" "}
            {t("Le trafic détaillé (requêtes par minute, erreurs, cache) se lit dans le tableau de bord Cloudflare.")}
          </p>
        </>
      )}
    </div>
  );
}

function Row({ label, value, alert, warn }: { label: string; value: string | number; alert?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-stone-600">{label}</dt>
      <dd className={`font-semibold ${alert ? "text-red-700" : warn ? "text-amber-700" : "text-stone-900"}`}>{value}</dd>
    </div>
  );
}
