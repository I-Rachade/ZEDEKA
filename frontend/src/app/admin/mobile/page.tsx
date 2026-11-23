"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { pushEndpoint, usePush } from "@/components/panel/partner";
import { STATUS_LABEL } from "@/components/panel/status";
import { adminFetch, useStaff } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { onRealtime } from "@/lib/realtime";
import type { Category as DeliveryCategory, ScreenSummary } from "@/lib/screen";
import { formatVital, LEVEL_COLOR, type Level, type TechData } from "@/lib/techScreen";
import { CATEGORY, type StaffNotification } from "../NotificationCenter";
import { useAdmin } from "../useAdmin";

// Appli mobile de l'admin (/admin/mobile), installable sur l'écran d'accueil du téléphone : les deux écrans (bureau et
// technique) en version de poche, les chiffres utiles et les alertes critiques en notification, pour suivre Zedeka
// en déplacement. Directeur et adjoint seulement (comme les écrans).

type Field = {
  driversOnline: number;
  driversFree: number;
  driversBusy: number;
  restaurantsOpen: number;
  shopsOpen: number;
  restaurantsTotal: number;
  ordersInProgress: number;
  toDispatch: number;
  inKitchen: number;
  onTheRoad: number;
  deliveredToday: number;
};
type Live = { office: ScreenSummary; field: Field; tech: TechData | null };
type Feed = { items: StaffNotification[]; unread: number };
type Tab = "home" | "office" | "tech" | "alerts";

const EVERY_MS = 30_000;
const adminApi = { apiFetch: adminFetch };

const CATEGORY_LABEL: Record<DeliveryCategory, string> = { FOOD: "Repas", PARCEL: "Colis", SHOP: "Boutique" };
const APPS: [key: string, label: string][] = [
  ["client", "Clients"],
  ["livreur", "Livreurs"],
  ["restaurant", "Restaurants"],
  ["marchand", "Marchands"],
  ["admin", "Équipe"],
];
const STATUS: Record<Level, { label: string; tone: string }> = {
  good: { label: "Tout va bien", tone: "bg-emerald-100 text-emerald-800" },
  warn: { label: "Points à surveiller", tone: "bg-amber-100 text-amber-800" },
  bad: { label: "Incident en cours", tone: "bg-red-100 text-red-800" },
  none: { label: "Chargement…", tone: "bg-stone-100 text-stone-600" },
};
const CHECK = { ok: "✓", warn: "!", fail: "✕", skip: "–" } as const;

const critical = (n: StaffNotification) => n.alarm || n.category === "TECH";
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const nf = (n: number) => n.toLocaleString("fr-FR");

function ago(iso: string, t: ReturnType<typeof useT>) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return t("à l'instant");
  if (m < 60) return t("il y a {n} min", { n: m });
  if (m < 24 * 60) return t("il y a {n} h", { n: Math.floor(m / 60) });
  return t("il y a {n} j", { n: Math.floor(m / 1440) });
}

function Tile({ label, value, hint, tone = "", href }: { label: string; value: string | number; hint?: string; tone?: string; href?: string }) {
  const t = useT();
  const body = (
    <div className={`h-full rounded-2xl border border-stone-200 bg-surface p-3 ${tone}`}>
      <p className="text-xs text-stone-600">{t(label)}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-stone-200 bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t(title)}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Anneau de progression vers l'objectif du jour.
function Ring({ value, target }: { value: number; target: number }) {
  const ratio = target > 0 ? Math.min(1, value / target) : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0" aria-hidden>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#e7e5e4" strokeWidth="10" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="#059669" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * ratio} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="56" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">
        {Math.round(ratio * 100)}%
      </text>
    </svg>
  );
}

// Livraisons par heure : aujourd'hui (barres) et hier à la même heure (trait).
function Hours({ today, yesterday, hour }: { today: number[]; yesterday: number[]; hour: number }) {
  const max = Math.max(1, ...today, ...yesterday);
  const from = 6;
  const hours = Array.from({ length: 24 - from }, (_, i) => i + from);
  return (
    <div className="flex h-24 items-end gap-[3px]" aria-hidden>
      {hours.map((h) => (
        <div key={h} className="relative flex h-full flex-1 items-end">
          <div className={`w-full rounded-t ${h === hour ? "bg-emerald-600" : "bg-emerald-300"}`} style={{ height: `${((today[h] ?? 0) / max) * 100}%` }} />
          <div className="absolute inset-x-0 border-t-2 border-stone-400" style={{ bottom: `${((yesterday[h] ?? 0) / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function InstallHint() {
  const t = useT();
  const [prompt, setPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone) return null;
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-semibold">{t("Installer l'appli sur ce téléphone")}</p>
      {prompt ? (
        <button onClick={() => prompt.prompt().then(() => setPrompt(null))} className="mt-2 rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white">
          {t("Installer")}
        </button>
      ) : (
        <p className="mt-1">
          {ios
            ? t("Dans Safari : bouton Partager, puis « Sur l'écran d'accueil ». Les notifications ne marchent sur iPhone qu'une fois l'appli installée.")
            : t("Menu du navigateur (⋮), puis « Installer l'application » ou « Ajouter à l'écran d'accueil ».")}
        </p>
      )}
    </div>
  );
}

function HomeTab({ live, feed, go }: { live: Live; feed: Feed | null; go: (t: Tab) => void }) {
  const t = useT();
  const { office, field, tech } = live;
  const alerts = (feed?.items ?? []).filter(critical).slice(0, 3);
  const level = tech?.vitality.level ?? "none";
  return (
    <div className="space-y-3">
      <InstallHint />
      <button onClick={() => go("office")} className="flex w-full items-center gap-4 rounded-2xl border border-stone-200 bg-surface p-4 text-left">
        <Ring value={office.today.delivered} target={office.goal.target} />
        <div className="min-w-0">
          <p className="text-sm text-stone-600">{t("Livrées aujourd'hui")}</p>
          <p className="text-3xl font-bold tabular-nums">
            {nf(office.today.delivered)}
            <span className="text-lg font-medium text-stone-500"> / {nf(office.goal.target)}</span>
          </p>
          <p className="text-xs text-stone-500">{t("Hier à la même heure : {n}", { n: office.yesterday.deliveredSoFar })}</p>
        </div>
      </button>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="À attribuer" value={field.toDispatch} tone={field.toDispatch ? "!border-amber-300 !bg-amber-50" : ""} href="/admin/dispatch" />
        <Tile label="En cours" value={field.ordersInProgress} hint={`${t("En cuisine")} ${field.inKitchen} · ${t("En route")} ${field.onTheRoad}`} />
        <Tile label="Livreurs libres" value={field.driversFree} hint={`${field.driversBusy} ${t("en course")} · ${field.driversOnline} ${t("en ligne")}`} />
        <Tile label="Commerces ouverts" value={field.restaurantsOpen + field.shopsOpen} hint={`${t("sur {n}", { n: field.restaurantsTotal })}`} />
        <Tile label="Reçues" value={office.today.received} hint={t("Hier à la même heure : {n}", { n: office.yesterday.createdSoFar })} />
        <Tile label="Temps moyen" value={office.today.avgMinutes != null ? `${office.today.avgMinutes} min` : "–"} hint={office.today.cancelled ? t("{n} annulée(s)", { n: office.today.cancelled }) : undefined} />
      </div>
      <button onClick={() => go("tech")} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-surface p-4 text-left">
        <div>
          <p className="text-sm text-stone-600">{t("Vitalité de l'appli")}</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[level].tone}`}>{t(STATUS[level].label)}</span>
          {tech?.live.online && <p className="mt-1 text-xs text-stone-500">{t("{n} en ligne maintenant", { n: tech.live.online.total })}</p>}
        </div>
        <p className="text-4xl font-bold tabular-nums" style={{ color: LEVEL_COLOR[level] }}>
          {tech ? tech.vitality.score : "–"}
        </p>
      </button>
      <Section
        title="Alertes critiques"
        action={
          <button onClick={() => go("alerts")} className="text-sm font-medium text-emerald-700">
            {t("Tout voir")}
          </button>
        }
      >
        {alerts.length ? <AlertList items={alerts} /> : <p className="text-sm text-stone-500">{t("Aucune alerte critique.")}</p>}
      </Section>
    </div>
  );
}

function OfficeTab({ office, field }: { office: ScreenSummary; field: Field }) {
  const t = useT();
  const hour = new Date(office.now).getHours();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Livrées" value={office.today.delivered} />
        <Tile label="En cours" value={office.today.inProgress} />
        <Tile label="Reçues" value={office.today.received} />
      </div>
      <Section title="Par type">
        <div className="grid grid-cols-3 gap-2 text-center">
          {(Object.keys(CATEGORY_LABEL) as DeliveryCategory[]).map((c) => (
            <div key={c} className="rounded-xl bg-stone-100 p-2">
              <p className="text-xl font-bold tabular-nums">{office.today.byCategory[c] ?? 0}</p>
              <p className="text-xs text-stone-600">{t(CATEGORY_LABEL[c])}</p>
            </div>
          ))}
        </div>
        {office.today.zedRides > 0 && <p className="mt-2 text-xs text-stone-500">{t("Courses Zed terminées : {n}", { n: office.today.zedRides })}</p>}
      </Section>
      <Section title="Livraisons par heure">
        <Hours today={office.hourly} yesterday={office.hourlyYesterday} hour={hour} />
        <p className="mt-1 text-xs text-stone-500">{t("Barres : aujourd'hui. Trait : hier.")}</p>
      </Section>
      <Section title="Terrain">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-stone-600">{t("À attribuer")}</dt>
          <dd className="text-right font-semibold tabular-nums">{field.toDispatch}</dd>
          <dt className="text-stone-600">{t("En cuisine")}</dt>
          <dd className="text-right font-semibold tabular-nums">{field.inKitchen}</dd>
          <dt className="text-stone-600">{t("En route")}</dt>
          <dd className="text-right font-semibold tabular-nums">{field.onTheRoad}</dd>
          <dt className="text-stone-600">{t("Livreurs en ligne")}</dt>
          <dd className="text-right font-semibold tabular-nums">{field.driversOnline}</dd>
        </dl>
      </Section>
      {office.leaderboard.length > 0 && (
        <Section title="Meilleurs livreurs du jour">
          <ol className="space-y-1 text-sm">
            {office.leaderboard.slice(0, 5).map((d, i) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {i + 1}. {d.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{d.deliveries}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section title="Dernières commandes">
        {office.feed.length ? (
          <ul className="divide-y divide-stone-100 text-sm">
            {office.feed.slice(0, 12).map((o) => (
              <li key={o.code} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {o.code} · {t(CATEGORY_LABEL[o.category])}
                  </p>
                  <p className="truncate text-xs text-stone-500">{[o.from, o.zone].filter(Boolean).join(" → ")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium">{t(STATUS_LABEL[o.status as keyof typeof STATUS_LABEL] ?? o.status)}</p>
                  <p className="text-xs text-stone-500">{hhmm(o.deliveredAt ?? o.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">{t("Pas encore de commande aujourd'hui.")}</p>
        )}
      </Section>
    </div>
  );
}

function TechTab({ tech }: { tech: TechData | null }) {
  const t = useT();
  if (!tech) return <p className="rounded-2xl bg-surface p-4 text-sm text-stone-500">{t("Le suivi technique n'est pas encore disponible.")}</p>;
  const level = tech.vitality.level;
  const online = tech.live.online;
  return (
    <div className="space-y-3">
      <Section title="Vitalité" action={<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[level].tone}`}>{t(STATUS[level].label)}</span>}>
        <p className="text-5xl font-bold tabular-nums" style={{ color: LEVEL_COLOR[level] }}>
          {tech.vitality.score}
          <span className="text-xl text-stone-400">/100</span>
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {tech.vitality.parts.map((p) => (
            <li key={p.key} className="flex justify-between gap-2">
              <span className="text-stone-600">{t(p.label)}</span>
              <span className="tabular-nums">
                {p.points}/{p.max}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="En ligne">
        <p className="text-3xl font-bold tabular-nums">{online ? online.total : "–"}</p>
        <p className="text-xs text-stone-500">{t("Actifs aujourd'hui : {n}", { n: tech.live.activeToday.total })}</p>
        <div className="mt-2 grid grid-cols-5 gap-1 text-center">
          {APPS.map(([k, label]) => (
            <div key={k} className="rounded-lg bg-stone-100 px-1 py-2">
              <p className="font-bold tabular-nums">{online?.byApp[k] ?? 0}</p>
              <p className="truncate text-[10px] text-stone-600">{t(label)}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Signes vitaux">
        <ul className="divide-y divide-stone-100 text-sm">
          {tech.vitals.map((v) => (
            <li key={v.key} className="flex items-center justify-between gap-2 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LEVEL_COLOR[v.level] }} />
                <span className="truncate">{t(v.label)}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatVital(v)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Erreurs en direct">
        {tech.live.errors.length ? (
          <ul className="space-y-2 text-sm">
            {tech.live.errors.slice(0, 8).map((e) => (
              <li key={e.fingerprint} className="rounded-xl bg-red-50 p-2">
                <p className="flex justify-between gap-2 font-medium text-red-900">
                  <span className="truncate">{e.route}</span>
                  <span className="shrink-0 tabular-nums">×{e.count}</span>
                </p>
                <p className="line-clamp-2 text-xs text-red-800">{e.message}</p>
                <p className="text-xs text-red-700/70">{ago(e.lastAt, t)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-emerald-700">{t("Aucune erreur dans la dernière heure.")}</p>
        )}
      </Section>
      {(tech.anomalies?.length ?? 0) > 0 && (
        <Section title="Anomalies">
          <ul className="space-y-2 text-sm">
            {tech.anomalies!.slice(0, 6).map((a, i) => (
              <li key={i} className="border-l-4 pl-2" style={{ borderColor: LEVEL_COLOR[a.level] }}>
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-stone-600">{a.detail}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(tech.improvements?.length ?? 0) > 0 && (
        <Section title="Quoi améliorer">
          <ul className="space-y-2 text-sm">
            {tech.improvements!.slice(0, 5).map((a, i) => (
              <li key={i} className="border-l-4 pl-2" style={{ borderColor: LEVEL_COLOR[a.level] }}>
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-stone-600">{a.why}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section
        title="Bilan du jour"
        action={
          <Link href="/admin/bilan" className="text-sm font-medium text-emerald-700">
            {t("Détail")}
          </Link>
        }
      >
        {tech.audit ? (
          <>
            <p className="text-sm">
              <span className="font-semibold text-red-700">{t("{n} critique(s)", { n: tech.audit.counts.critical })}</span>
              {" · "}
              <span className="font-semibold text-amber-700">{t("{n} haute(s)", { n: tech.audit.counts.high })}</span>
              <span className="text-stone-500"> · {hhmm(tech.audit.ranAt)}</span>
            </p>
            <ul className="mt-2 grid grid-cols-1 gap-1 text-sm">
              {tech.audit.checks.map((c) => (
                <li key={c.key} className="flex gap-2">
                  <span className={`w-4 shrink-0 text-center font-bold ${c.status === "fail" ? "text-red-600" : c.status === "warn" ? "text-amber-600" : c.status === "ok" ? "text-emerald-600" : "text-stone-400"}`}>{CHECK[c.status]}</span>
                  <span className="min-w-0 truncate">
                    {t(c.label)} <span className="text-stone-500">· {c.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-stone-500">{t("Pas encore de bilan aujourd'hui (6 h).")}</p>
        )}
      </Section>
    </div>
  );
}

function AlertList({ items }: { items: StaffNotification[] }) {
  const t = useT();
  return (
    <ul className="space-y-2">
      {items.map((n) => (
        <li key={n.id}>
          <Link href={n.url} className={`block rounded-xl p-3 text-sm ${critical(n) ? "bg-red-50" : "bg-stone-50"}`}>
            <p className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CATEGORY[n.category].tone}`}>{t(CATEGORY[n.category].label)}</span>
              <span className="text-xs text-stone-500">{ago(n.createdAt, t)}</span>
            </p>
            <p className={`mt-1 font-semibold ${critical(n) ? "text-red-900" : ""}`}>{n.title}</p>
            <p className="text-xs text-stone-600">{n.body}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AlertsTab({ feed }: { feed: Feed | null }) {
  const t = useT();
  const push = usePush(adminApi);
  const [onlyCritical, setOnlyCritical] = useState(true);
  const [deviceCritical, setDeviceCritical] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Réglage de cet appareil, relu dès que les notifications sont actives.
  useEffect(() => {
    if (push.state !== "on") return setDeviceCritical(null);
    pushEndpoint().then((endpoint) => {
      if (!endpoint) return;
      adminFetch<{ on: boolean }>("/push/critical", { method: "POST", body: { endpoint } }).then(
        (r) => setDeviceCritical(r.on),
        () => setDeviceCritical(null),
      );
    });
  }, [push.state]);

  const setCritical = async (on: boolean) => {
    const endpoint = await pushEndpoint();
    if (!endpoint) return;
    try {
      const r = await adminFetch<{ on: boolean }>("/push/critical", { method: "POST", body: { endpoint, on } });
      setDeviceCritical(r.on);
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  const enable = async () => {
    // Téléphone dédié aux déplacements : seulement les alertes critiques, par défaut.
    if (await push.enable()) await setCritical(true);
  };

  const items = (feed?.items ?? []).filter((n) => !onlyCritical || critical(n));
  return (
    <div className="space-y-3">
      <Section title="Notifications sur ce téléphone">
        {push.state === "on" ? (
          <div className="space-y-3 text-sm">
            <p className="text-emerald-700">{t("Activées sur cet appareil.")}</p>
            {deviceCritical !== null && (
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-emerald-600" checked={deviceCritical} onChange={(e) => setCritical(e.target.checked)} />
                <span>
                  <span className="font-medium">{t("Alertes critiques seulement")}</span>
                  <span className="block text-xs text-stone-500">{t("Urgences (commande sans réponse, course refusée, créneau manqué) et alertes techniques (panne, anomalie, faille). Les autres appareils reçoivent toujours tout.")}</span>
                </span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => push.test().then((r) => setNote(t("Notification d'essai envoyée à {n} appareil(s).", { n: r.sent })), (e) => setNote((e as Error).message))} className="rounded-lg border border-stone-300 px-3 py-2 font-medium">
                {t("Envoyer un essai")}
              </button>
              <button onClick={push.disable} className="rounded-lg border border-stone-300 px-3 py-2 font-medium">
                {t("Désactiver")}
              </button>
            </div>
          </div>
        ) : push.state === "off" ? (
          <div className="space-y-2 text-sm">
            <p className="text-stone-600">{t("Recevez les alertes critiques même quand l'appli est fermée.")}</p>
            <button onClick={enable} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white">
              {t("Activer les alertes critiques")}
            </button>
          </div>
        ) : push.state === "denied" ? (
          <p className="text-sm text-amber-800">{t("Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site.")}</p>
        ) : push.state === "unsupported" ? (
          <p className="text-sm text-stone-600">{t("Ce navigateur ne reçoit pas les notifications. Sur iPhone, installez d'abord l'appli sur l'écran d'accueil.")}</p>
        ) : (
          <p className="text-sm text-stone-500">{t("Chargement…")}</p>
        )}
        {note && <p className="mt-2 text-xs text-stone-600">{note}</p>}
      </Section>
      <div className="flex gap-2">
        {[true, false].map((v) => (
          <button key={String(v)} onClick={() => setOnlyCritical(v)} className={`rounded-full px-3 py-1.5 text-sm font-medium ${onlyCritical === v ? "bg-stone-900 text-white" : "bg-surface text-stone-700 ring-1 ring-stone-200"}`}>
            {v ? t("Critiques") : t("Toutes")}
          </button>
        ))}
      </div>
      {items.length ? <AlertList items={items} /> : <p className="rounded-2xl bg-surface p-4 text-sm text-stone-500">{t("Aucune alerte pour le moment.")}</p>}
    </div>
  );
}

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: "home", label: "Aperçu", icon: "◎" },
  { value: "office", label: "Livraisons", icon: "▤" },
  { value: "tech", label: "Technique", icon: "♥" },
  { value: "alerts", label: "Alertes", icon: "!" },
];

export default function MobileAdminPage() {
  const t = useT();
  const staff = useStaff();
  const [tab, setTab] = useState<Tab>("home");
  const { data: live, error, reload, savedAt } = useAdmin<Live>("/screens/live");
  const [feed, setFeed] = useState<Feed | null>(null);

  const loadFeed = useCallback(() => {
    adminFetch<Feed>("/notifications?limit=50").then(setFeed, () => {});
  }, []);

  // Relu toutes les 30 s, à chaque commande qui change (temps réel de l'admin) et au retour sur l'appli.
  useEffect(() => {
    const all = () => {
      reload();
      loadFeed();
    };
    loadFeed();
    const timer = setInterval(all, EVERY_MS);
    const stop = onRealtime(all);
    const onVisible = () => document.visibilityState === "visible" && all();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload, loadFeed]);

  const criticalCount = (feed?.items ?? []).filter((n) => critical(n) && Date.now() - new Date(n.createdAt).getTime() < 86_400_000).length;

  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-stone-100 pb-24">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-stone-900 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <div className="flex items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <div>
            <p className="font-semibold leading-tight">{t("Zedeka Pilote")}</p>
            <p className="text-xs text-stone-400">{live ? t("Mis à jour à {h}", { h: hhmm(live.office.now) }) : t("Chargement…")}</p>
          </div>
        </div>
        <Link href="/admin" className="rounded-lg bg-white/10 px-3 py-1.5 text-sm">
          {t("Admin complet")}
        </Link>
      </header>
      <main className="space-y-3 p-4">
        {savedAt && <p className="rounded-xl bg-amber-100 p-2 text-xs text-amber-900">{t("Hors ligne : derniers chiffres reçus.")}</p>}
        {error && !live && <p className="rounded-xl bg-red-100 p-3 text-sm text-red-800">{error}</p>}
        {!live && !error && <p className="p-4 text-sm text-stone-500">{t("Chargement…")}</p>}
        {live && tab === "home" && <HomeTab live={live} feed={feed} go={setTab} />}
        {live && tab === "office" && <OfficeTab office={live.office} field={live.field} />}
        {live && tab === "tech" && <TechTab tech={live.tech} />}
        {tab === "alerts" && <AlertsTab feed={feed} />}
        {staff && <p className="pt-2 text-center text-xs text-stone-400">{staff.name}</p>}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-lg border-t border-stone-200 bg-surface pb-[env(safe-area-inset-bottom)]">
        {TABS.map((x) => (
          <button key={x.value} onClick={() => setTab(x.value)} className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${tab === x.value ? "font-semibold text-emerald-700" : "text-stone-500"}`}>
            <span className="text-lg leading-none" aria-hidden>
              {x.icon}
            </span>
            {t(x.label)}
            {x.value === "alerts" && criticalCount > 0 && <span className="absolute right-1/4 top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{criticalCount}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
