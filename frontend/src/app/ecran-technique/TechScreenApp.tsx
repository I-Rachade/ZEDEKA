"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { useT } from "@/lib/i18n/client";
import { onRealtime, useRealtime } from "@/lib/realtime";
import { readScreenKey, saveScreenKey, ScreenAuthError, screenFetch } from "@/lib/screen";
import { formatVital, LEVEL_COLOR, type Level, type TechData } from "@/lib/techScreen";
import { Clock, Pairing } from "../ecran/ScreenApp";

// Écran technique : santé de l'appli en direct, sur un écran mural (télé, PC, tablette). Branché par code comme
// l'écran du bureau (Admin > Écran du bureau > Brancher) ; la page demande un code « écran technique ».
// Six zones : vitalité, utilisateurs en ligne, signes vitaux, erreurs et anomalies, quoi améliorer, bilan du jour.
// Rien de personnel : routes, messages raccourcis et nombres seulement.

const EVERY_MS = 30_000;
const MIN_GAP_MS = 3_000;
const RELOAD_MS = 6 * 3_600_000;

const APPS: [key: string, label: string][] = [
  ["client", "Clients"],
  ["livreur", "Livreurs"],
  ["restaurant", "Restaurants"],
  ["marchand", "Marchands"],
  ["admin", "Équipe"],
];
const SOURCE: Record<string, { label: string; tone: string }> = {
  api: { label: "ERREUR", tone: "bg-red-500/20 text-red-200" },
  cron: { label: "TÂCHE", tone: "bg-red-500/20 text-red-200" },
  client: { label: "TÉLÉPHONE", tone: "bg-sky-500/20 text-sky-200" },
  livreur: { label: "TÉLÉPHONE", tone: "bg-sky-500/20 text-sky-200" },
  restaurant: { label: "TÉLÉPHONE", tone: "bg-sky-500/20 text-sky-200" },
  marchand: { label: "TÉLÉPHONE", tone: "bg-sky-500/20 text-sky-200" },
  admin: { label: "TÉLÉPHONE", tone: "bg-sky-500/20 text-sky-200" },
};
const STATUS: Record<Level, { label: string; bg: string; ring: string }> = {
  good: { label: "Tout va bien", bg: "bg-emerald-500/15 text-emerald-300", ring: "from-stone-950 to-stone-950" },
  warn: { label: "Points à surveiller", bg: "bg-amber-500/20 text-amber-200", ring: "from-amber-950/40 to-stone-950" },
  bad: { label: "Incident en cours", bg: "bg-red-500/25 text-red-200", ring: "from-red-950/60 to-stone-950" },
  none: { label: "Chargement…", bg: "bg-white/10 text-stone-300", ring: "from-stone-950 to-stone-950" },
};
const CHECK_MARK = { ok: { sign: "✓", tone: "bg-emerald-500/20 text-emerald-300" }, warn: { sign: "!", tone: "bg-amber-500/20 text-amber-200" }, fail: { sign: "✕", tone: "bg-red-500/25 text-red-200" }, skip: { sign: "–", tone: "bg-white/10 text-stone-400" } };

const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

// Courbe simple (aujourd'hui en plein, semaine dernière en pointillé), sur la journée (0 h → 24 h).
function DayCurve({ today, lastWeek }: { today: { at: string; value: number }[]; lastWeek: { at: string; value: number }[] }) {
  const all = [...today, ...lastWeek].map((p) => p.value);
  const max = Math.max(1, ...all);
  const pts = (list: { at: string; value: number }[]) =>
    list
      .map((p) => {
        const d = new Date(p.at);
        const x = ((d.getUTCHours() * 60 + d.getUTCMinutes()) / 1440) * 400;
        return `${x.toFixed(1)},${(100 - (p.value / max) * 92).toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg viewBox="0 0 400 104" className="h-full w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts(lastWeek)} fill="none" stroke="#78716c" strokeWidth="2" strokeDasharray="6 6" />
      <polyline points={pts(today)} fill="none" stroke="#5fcf94" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

function Panel({ title, n, children, right, className = "" }: { title: string; n: number; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  const t = useT();
  return (
    <section className={`flex min-h-0 flex-col gap-[0.8vw] rounded-[1.2vw] border border-white/10 bg-stone-900 p-[1.2vw] ${className}`}>
      <div className="flex items-baseline justify-between gap-[1vw]">
        <h2 className="text-[0.95vw] font-semibold uppercase tracking-wider text-stone-400">
          {n} · {t(title)}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function TechScreenApp() {
  const t = useT();
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [revoked, setRevoked] = useState(false);
  const [data, setData] = useState<TechData | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [wrongKind, setWrongKind] = useState(false);
  const [, tick] = useState(0);
  const lastLoad = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("cle");
    if (fromLink) {
      saveScreenKey(fromLink, "TECH");
      if (readScreenKey("TECH") === fromLink) {
        params.delete("cle");
        const rest = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
      }
    }
    setKey(fromLink ?? readScreenKey("TECH"));
  }, []);

  const paired = useCallback((k: string) => {
    saveScreenKey(k, "TECH");
    setRevoked(false);
    setWrongKind(false);
    setKey(k);
  }, []);

  const load = useCallback(() => {
    if (!key) return;
    lastLoad.current = Date.now();
    fetch("/api/screen/tech", { headers: { "x-screen-key": key }, cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) throw new ScreenAuthError("Écran non autorisé");
        if (res.status === 403) {
          setWrongKind(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData((await res.json()) as TechData);
        setLastOk(Date.now());
        setOffline(false);
      })
      .catch((e) => {
        if (e instanceof ScreenAuthError) {
          saveScreenKey(null, "TECH");
          setRevoked(true);
          setKey(null);
        } else setOffline(true);
      });
  }, [key]);

  useEffect(() => {
    if (!key) return;
    load();
    const every = setInterval(load, EVERY_MS);
    const clock = setInterval(() => tick((n) => n + 1), 15_000);
    let wait: number | null = null;
    // Nouvelle erreur ou commande changée : relecture, au plus toutes les 3 s.
    const stop = onRealtime(() => {
      if (wait !== null) return;
      wait = window.setTimeout(() => {
        wait = null;
        load();
      }, Math.max(0, MIN_GAP_MS - (Date.now() - lastLoad.current)));
    });
    return () => {
      clearInterval(every);
      clearInterval(clock);
      if (wait !== null) clearTimeout(wait);
      stop();
    };
  }, [key, load]);

  useRealtime(key && !wrongKind ? async () => (await screenFetch<{ ticket?: string }>("/tech/realtime", key)).ticket ?? null : null, key ?? null);

  // Écran toujours allumé, rechargement complet toutes les 6 h, F : plein écran.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const ask = () => {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      wl?.request("screen").then((l) => (lock = l), () => {});
    };
    ask();
    const onVisible = () => document.visibilityState === "visible" && ask();
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "f") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("keydown", onKey);
    const reload = setTimeout(() => window.location.reload(), RELOAD_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("keydown", onKey);
      clearTimeout(reload);
      void lock?.release().catch(() => {});
    };
  }, []);

  if (key === undefined) return <main className="min-h-screen bg-stone-950" />;
  if (!key)
    return (
      <Pairing
        revoked={revoked}
        onPaired={paired}
        kind="TECH"
        title="Écran technique"
        hint="Pour l'afficher ici, tapez ce code dans l'admin Zedeka, menu « Écran du bureau » > Brancher :"
        path="/ecran-technique"
      />
    );
  if (wrongKind)
    return (
      <main className="grid min-h-screen place-items-center bg-stone-950 p-[4vw] text-center text-white">
        <div className="max-w-4xl space-y-[3vh]">
          <h1 className="font-display text-[3vw] font-extrabold">{t("Cet écran est branché comme écran du bureau")}</h1>
          <button
            type="button"
            className="rounded-full bg-emerald-500 px-[2vw] py-[1vh] text-[1.5vw] font-bold text-emerald-950"
            onClick={() => {
              saveScreenKey(null, "TECH");
              setWrongKind(false);
              setKey(null);
            }}
          >
            {t("Afficher un code pour l'écran technique")}
          </button>
        </div>
      </main>
    );

  const stale = offline && lastOk != null;
  const level: Level = data ? data.vitality.level : "none";
  const status = STATUS[level];
  const minutesSilent = lastOk ? Math.floor((Date.now() - lastOk) / 60_000) : 0;
  const errors = data?.live.errors ?? [];
  const anomalies = data?.anomalies ?? [];
  const online = data?.live.online;
  const lastWeek = data?.live.onlineLastWeek ?? null;
  const delta = online && lastWeek ? Math.round(((online.total - lastWeek) / Math.max(1, lastWeek)) * 100) : null;
  const improvements = data?.improvements?.length
    ? data.improvements
    : (data?.api.slowest ?? [])
        .filter((r) => (r.p95 ?? 0) > 1000)
        .map((r) => ({ title: t("Accélérer {r}", { r: r.route }), why: t("95 % des réponses en {s}", { s: formatVital({ key: "", label: "", value: r.p95, unit: "ms", level: "none" }) }), level: "warn" as Level }))
        .concat((data?.api.failing ?? []).map((r) => ({ title: t("Corriger les erreurs de {r}", { r: r.route }), why: t("{n} erreurs sur 24 h", { n: r.errors }), level: "bad" as Level })))
        .slice(0, 5);
  const audit = data?.audit ?? null;

  return (
    <main className={`flex h-screen cursor-none flex-col gap-[1vw] overflow-hidden bg-gradient-to-b ${status.ring} p-[1.2vw] text-white`}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-[1vw]">
          <LogoMark className="h-[3.6vw] w-[3.6vw]" />
          <div>
            <p className="font-display text-[1.9vw] font-extrabold leading-tight">{t("Écran technique")}</p>
            <p className="text-[0.95vw] text-stone-400">{t("Santé de l'appli Zedeka, en direct")}</p>
          </div>
        </div>
        <div className="flex items-center gap-[1.6vw]">
          <span className={`flex items-center gap-2 rounded-full px-[1.2vw] py-[0.6vh] text-[1.2vw] font-semibold ${status.bg}`}>
            <span className="h-3 w-3 rounded-full" style={{ background: LEVEL_COLOR[level] }} />
            {t(status.label)}
          </span>
          <span className={`flex items-center gap-2 text-[1vw] ${stale ? "text-red-300" : "text-stone-400"}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${stale ? "bg-red-400" : "animate-pulse bg-emerald-400"}`} />
            {stale ? t("Plus de nouvelles depuis {n} min", { n: Math.max(1, minutesSilent) }) : t("En direct")}
          </span>
          <Clock />
        </div>
      </header>

      {!data ? (
        <div className="grid flex-1 place-items-center text-[2vw] text-stone-400">{offline ? t("Connexion perdue, nouvel essai…") : t("Chargement…")}</div>
      ) : (
        <>
          <div className="grid h-[38%] grid-cols-[22%_1fr_33%] gap-[1vw]">
            <Panel n={1} title="Vitalité">
              <div className="flex items-baseline gap-[0.4vw]">
                <span className="font-display text-[7.5vw] font-extrabold leading-none tabular-nums" style={{ color: LEVEL_COLOR[level] }}>
                  {data.vitality.score}
                </span>
                <span className="text-[1.8vw] text-stone-400">/100</span>
              </div>
              <ul className="mt-auto space-y-[0.3vh] text-[0.85vw]">
                {data.vitality.parts
                  .filter((p) => p.points < p.max)
                  .slice(0, 4)
                  .map((p) => (
                    <li key={p.key} className="flex justify-between text-stone-300">
                      <span>{t(p.label)}</span>
                      <span className="tabular-nums text-amber-200">−{Math.round((p.max - p.points) * 10) / 10}</span>
                    </li>
                  ))}
                {data.vitality.parts.every((p) => p.points >= p.max) && <li className="text-stone-400">{t("Aucun point perdu")}</li>}
              </ul>
            </Panel>

            <Panel n={2} title="Utilisateurs en ligne" right={<span className="text-[0.95vw] text-stone-300">{t("Actifs aujourd'hui : {n}", { n: data.live.activeToday.total.toLocaleString("fr-FR") })}</span>}>
              <div className="flex min-h-0 flex-1 items-end gap-[1.5vw]">
                <div className="shrink-0">
                  <p className="font-display text-[5vw] font-extrabold leading-none tabular-nums">{online ? online.total.toLocaleString("fr-FR") : "–"}</p>
                  {delta !== null && (
                    <p className={`text-[0.95vw] ${delta >= 0 ? "text-emerald-300" : "text-amber-200"}`}>
                      {delta >= 0 ? "+" : ""}
                      {t("{n} % vs la même heure la semaine dernière", { n: delta })}
                    </p>
                  )}
                </div>
                <div className="h-full min-w-0 flex-1">
                  <DayCurve today={data.live.today} lastWeek={data.live.lastWeek} />
                </div>
              </div>
              <div className="grid grid-cols-5 gap-[0.6vw]">
                {APPS.map(([k, label]) => (
                  <div key={k} className="rounded-[0.7vw] bg-stone-950 px-[0.8vw] py-[0.6vh]">
                    <p className="text-[0.8vw] text-stone-400">{t(label)}</p>
                    <p className="font-display text-[1.9vw] font-bold tabular-nums">{online ? (online.byApp[k] ?? 0).toLocaleString("fr-FR") : "–"}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel n={3} title="Signes vitaux">
              <div className="grid flex-1 grid-cols-2 gap-[0.6vw]">
                {data.vitals.map((v) => (
                  <div key={v.key} className="flex items-center justify-between gap-[0.6vw] rounded-[0.7vw] bg-stone-950 px-[0.8vw]">
                    <span className="flex min-w-0 items-center gap-[0.5vw] text-[0.85vw] text-stone-300">
                      <span className="h-[0.6vw] w-[0.6vw] shrink-0 rounded-full" style={{ background: LEVEL_COLOR[v.level] }} />
                      <span className="truncate">{t(v.label)}</span>
                    </span>
                    <span className="font-display text-[1.3vw] font-bold tabular-nums" style={{ color: LEVEL_COLOR[v.level] }}>
                      {formatVital(v)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[1fr_29%_27%] gap-[1vw]">
            <Panel n={4} title="Erreurs et anomalies en direct" right={<span className="text-[0.9vw] text-stone-400">{t("Dernière heure : {e} erreurs", { e: errors.reduce((a, e) => a + e.count, 0) })}</span>}>
              <ul className="flex min-h-0 flex-1 flex-col gap-[0.5vw] overflow-hidden">
                {anomalies.map((a) => (
                  <li key={`${a.at}-${a.title}`} className="flex items-start gap-[0.8vw] rounded-[0.7vw] bg-stone-950 px-[0.8vw] py-[0.6vh]">
                    <span className="w-[3vw] shrink-0 text-[0.95vw] tabular-nums text-stone-400">{time(a.at)}</span>
                    <span className="shrink-0 rounded-md bg-amber-500/20 px-[0.5vw] py-[0.2vh] text-[0.75vw] font-bold text-amber-200">{t("ANOMALIE")}</span>
                    <div className="min-w-0">
                      <p className="text-[1vw] font-semibold">{a.title}</p>
                      <p className="truncate text-[0.8vw] text-stone-400">{a.detail}</p>
                    </div>
                  </li>
                ))}
                {errors.map((e) => {
                  const src = SOURCE[e.source] ?? SOURCE.api;
                  return (
                    <li key={e.fingerprint} className="flex items-start gap-[0.8vw] rounded-[0.7vw] bg-stone-950 px-[0.8vw] py-[0.6vh]">
                      <span className="w-[3vw] shrink-0 text-[0.95vw] tabular-nums text-stone-400">{time(e.lastAt)}</span>
                      <span className={`shrink-0 rounded-md px-[0.5vw] py-[0.2vh] text-[0.75vw] font-bold ${src.tone}`}>{t(src.label)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[0.95vw] font-semibold">
                          {e.route}
                          {e.status ? ` · ${e.status}` : ""}
                        </p>
                        <p className="truncate text-[0.8vw] text-stone-400">{e.message}</p>
                      </div>
                      <span className="shrink-0 font-display text-[1.1vw] tabular-nums text-stone-300">×{e.count}</span>
                    </li>
                  );
                })}
                {!errors.length && !anomalies.length && <li className="grid flex-1 place-items-center text-[1.2vw] text-emerald-300">{t("Aucune erreur depuis une heure")}</li>}
              </ul>
            </Panel>

            <Panel n={5} title="Quoi améliorer">
              <ol className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {improvements.map((x, i) => (
                  <li key={x.title} className="flex gap-[0.8vw] border-b border-white/10 py-[0.8vh]">
                    <span className="w-[1.6vw] font-display text-[1.6vw] font-extrabold leading-none" style={{ color: LEVEL_COLOR[x.level] }}>
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[1vw] font-semibold">{x.title}</p>
                      <p className="text-[0.8vw] text-stone-400">{x.why}</p>
                    </div>
                  </li>
                ))}
                {!improvements.length && <li className="grid flex-1 place-items-center text-[1.1vw] text-stone-400">{t("Rien d'urgent à améliorer")}</li>}
              </ol>
            </Panel>

            <Panel n={6} title="Bilan du jour" right={audit && <span className="text-[0.85vw] text-stone-400">{t("Lancé à {h}", { h: time(audit.ranAt) })}</span>}>
              {audit ? (
                <>
                  <div className="flex flex-wrap gap-[0.4vw] text-[0.8vw] font-bold">
                    <span className="rounded-md bg-red-500/20 px-[0.5vw] py-[0.3vh] text-red-200">{t("{n} critique", { n: audit.counts.critical })}</span>
                    <span className="rounded-md bg-amber-500/20 px-[0.5vw] py-[0.3vh] text-amber-200">{t("{n} haute", { n: audit.counts.high })}</span>
                    <span className="rounded-md bg-white/10 px-[0.5vw] py-[0.3vh] text-stone-300">{t("{n} moyenne", { n: audit.counts.moderate })}</span>
                  </div>
                  <ul className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden">
                    {audit.checks.map((c) => (
                      <li key={c.key} className="flex items-center justify-between gap-[0.6vw] text-[0.9vw]">
                        <span className="flex min-w-0 items-center gap-[0.6vw]">
                          <span className={`grid h-[1.4vw] w-[1.4vw] shrink-0 place-items-center rounded-full text-[0.8vw] font-bold ${CHECK_MARK[c.status].tone}`}>{CHECK_MARK[c.status].sign}</span>
                          <span className="truncate">{t(c.label)}</span>
                        </span>
                        <span className="shrink-0 truncate text-[0.8vw] text-stone-400">{c.note}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="grid flex-1 place-items-center text-center text-[1.1vw] text-stone-400">{t("Premier bilan de sécurité et d'état à 6 h.")}</p>
              )}
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}
