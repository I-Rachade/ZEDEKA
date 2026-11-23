"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { useT } from "@/lib/i18n/client";
import { onRealtime, useRealtime } from "@/lib/realtime";
import { crossedMilestone, milestoneStep, readScreenKey, saveScreenKey, ScreenAuthError, screenFetch, type ScreenMap, type ScreenSummary } from "@/lib/screen";
import CounterView, { CATEGORY } from "./CounterView";
import { chimeOrder, chimeParty, confetti } from "./effects";

// La carte (Leaflet) ne se charge que dans le navigateur.
const MapView = dynamic(() => import("./MapView"), { ssr: false });

// Écran du bureau : grand moniteur piloté par un Raspberry Pi en mode kiosque (guide : ecran-bureau/).
// Réglages dans l'adresse :
//   vue=rotation (défaut) | compteur | carte   duree=40 (secondes par écran en rotation)   son=0 (muet)
// Touches : ← → changer d'écran, P pause de la rotation, F plein écran.

type View = "compteur" | "carte";
type Party = { id: number; emoji: string; title: string; subtitle: string };
type Toast = { code: string; label: string; emoji: string };

const SUMMARY_EVERY_MS = 30_000;
const MAP_EVERY_MS = 15_000;
// Plusieurs signaux temps réel d'affilée : une lecture toutes les 3 s au plus.
const MIN_GAP_MS = 3_000;
// Rechargement complet toutes les 6 h : nouvelle version du site, mémoire du navigateur remise à zéro.
const RELOAD_MS = 6 * 3_600_000;

function useOptions() {
  return useMemo(() => {
    if (typeof window === "undefined") return { mode: "rotation", seconds: 40, sound: true };
    const p = new URLSearchParams(window.location.search);
    const mode = p.get("vue") === "compteur" || p.get("vue") === "carte" ? (p.get("vue") as View) : "rotation";
    const seconds = Math.min(600, Math.max(10, Number(p.get("duree")) || 40));
    return { mode, seconds, sound: p.get("son") !== "0" };
  }, []);
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  return (
    <div className="text-right leading-tight">
      <p className="font-display text-[2.4vw] font-extrabold tabular-nums">{now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</p>
      <p className="text-[1vw] capitalize text-stone-400">{now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</p>
    </div>
  );
}

function Setup({ revoked }: { revoked: boolean }) {
  const t = useT();
  return (
    <main className="grid min-h-screen place-items-center bg-stone-950 p-10 text-center text-white">
      <div className="max-w-3xl space-y-6">
        <LogoMark className="mx-auto h-24 w-24" />
        <h1 className="font-display text-5xl font-extrabold">{revoked ? t("Ce lien d'écran a été révoqué") : t("Écran du bureau")}</h1>
        <p className="text-2xl text-stone-300">
          {t("Créez un lien dans l'admin (Écran du bureau), puis ouvrez-le sur cet appareil. Il est gardé ensuite, même après un redémarrage.")}
        </p>
      </div>
    </main>
  );
}

export default function ScreenApp() {
  const t = useT();
  const options = useOptions();
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [revoked, setRevoked] = useState(false);
  const [summary, setSummary] = useState<ScreenSummary | null>(null);
  const [map, setMap] = useState<ScreenMap | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState<View>(options.mode === "carte" ? "carte" : "compteur");
  const [paused, setPaused] = useState(false);
  const [party, setParty] = useState<Party | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const canvas = useRef<HTMLCanvasElement>(null);
  const seen = useRef<{ codes: Set<string> | null; delivered: number | null }>({ codes: null, delivered: null });
  const lastLoad = useRef(0);

  // Clé : depuis le lien (?cle=…), gardée sur l'appareil, puis retirée de l'adresse.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("cle");
    if (fromLink) {
      saveScreenKey(fromLink);
      if (readScreenKey() === fromLink) {
        params.delete("cle");
        const rest = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
      }
    }
    setKey(fromLink ?? readScreenKey());
  }, []);

  const celebrate = useCallback(
    (p: Omit<Party, "id">) => {
      setParty({ ...p, id: Date.now() });
      if (options.sound) chimeParty();
    },
    [options.sound],
  );

  const onSummary = useCallback(
    (s: ScreenSummary) => {
      const prev = seen.current;
      // Nouvelles commandes (pas au premier affichage) : bandeau et petite sonnerie.
      const codes = new Set(s.feed.map((o) => o.code));
      if (prev.codes) {
        const added = s.feed.filter((o) => !prev.codes!.has(o.code) && o.status !== "CANCELLED");
        if (added.length) {
          setToasts((list) => [...added.slice(0, 3).map((o) => ({ code: o.code, emoji: CATEGORY[o.category].emoji, label: o.from ?? t(CATEGORY[o.category].label) })), ...list].slice(0, 3));
          setFresh(new Set(added.map((o) => o.code)));
          if (options.sound) chimeOrder();
        }
      }
      // Paliers : record battu, objectif atteint, ou toutes les 10 livraisons.
      const before = prev.delivered;
      const after = s.today.delivered;
      if (before != null && after > before) {
        const record = s.record?.count ?? 0;
        if (record > 0 && before <= record && after > record) celebrate({ emoji: "🏅", title: t("Nouveau record !"), subtitle: t("{n} livraisons en une journée, du jamais vu. Bravo l'équipe !", { n: after }) });
        else if (before < s.goal.target && after >= s.goal.target) celebrate({ emoji: "🎯", title: t("Objectif du jour atteint !"), subtitle: t("{n} livraisons. On vise encore plus haut ?", { n: after }) });
        else {
          const m = crossedMilestone(before, after, milestoneStep(s.goal.target));
          if (m) celebrate({ emoji: "🎉", title: t("{n} livraisons !", { n: m }), subtitle: t("Encore {n} pour l'objectif du jour.", { n: Math.max(0, s.goal.target - after) }) });
        }
      }
      // Nouveau jour : le compteur redescend, on repart de là sans fête.
      seen.current = { codes, delivered: after };
      setSummary(s);
    },
    [celebrate, options.sound, t],
  );

  const fail = useCallback((e: unknown) => {
    if (e instanceof ScreenAuthError) {
      saveScreenKey(null);
      setRevoked(true);
      setKey(null);
    } else setOffline(true);
  }, []);

  const loadSummary = useCallback(() => {
    if (!key) return;
    screenFetch<ScreenSummary>("/summary", key)
      .then((s) => {
        onSummary(s);
        setLastOk(Date.now());
        setOffline(false);
      })
      .catch(fail);
  }, [key, onSummary, fail]);

  const loadMap = useCallback(() => {
    if (!key) return;
    screenFetch<ScreenMap>("/map", key)
      .then((m) => {
        setMap(m);
        setOffline(false);
      })
      .catch(fail);
  }, [key, fail]);

  const loadAll = useCallback(() => {
    lastLoad.current = Date.now();
    loadSummary();
    loadMap();
  }, [loadSummary, loadMap]);

  useEffect(() => {
    if (!key) return;
    loadAll();
    const a = setInterval(loadSummary, SUMMARY_EVERY_MS);
    const b = setInterval(loadMap, MAP_EVERY_MS);
    let wait: number | null = null;
    // Signal temps réel (une commande a changé) : relecture, au plus toutes les 3 s.
    const stop = onRealtime(() => {
      if (wait !== null) return;
      const gap = Math.max(0, MIN_GAP_MS - (Date.now() - lastLoad.current));
      wait = window.setTimeout(() => {
        wait = null;
        loadAll();
      }, gap);
    });
    return () => {
      clearInterval(a);
      clearInterval(b);
      if (wait !== null) clearTimeout(wait);
      stop();
    };
  }, [key, loadAll, loadSummary, loadMap]);

  useRealtime(key ? async () => (await screenFetch<{ ticket?: string }>("/realtime", key)).ticket ?? null : null, key ?? null);

  // Rotation entre les deux écrans.
  useEffect(() => {
    if (options.mode !== "rotation" || paused) return;
    const id = setInterval(() => setView((v) => (v === "compteur" ? "carte" : "compteur")), options.seconds * 1000);
    return () => clearInterval(id);
  }, [options.mode, options.seconds, paused]);

  // Clavier (facultatif) : ← → changer, P pause, F plein écran.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") setView((v) => (v === "compteur" ? "carte" : "compteur"));
      else if (e.key.toLowerCase() === "p") setPaused((p) => !p);
      else if (e.key.toLowerCase() === "f") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Écran toujours allumé (si le navigateur le permet), et rechargement complet toutes les 6 h.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const ask = () => {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      wl?.request("screen").then((l) => (lock = l), () => {});
    };
    ask();
    const onVisible = () => document.visibilityState === "visible" && ask();
    document.addEventListener("visibilitychange", onVisible);
    const reload = setTimeout(() => window.location.reload(), RELOAD_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(reload);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Confettis pendant la fête, puis elle s'efface.
  useEffect(() => {
    if (!party || !canvas.current) return;
    const stop = confetti(canvas.current, 6000);
    const id = setTimeout(() => setParty(null), 7000);
    return () => {
      stop();
      clearTimeout(id);
    };
  }, [party]);

  useEffect(() => {
    if (!toasts.length) return;
    const id = setTimeout(() => {
      setToasts((list) => list.slice(0, -1));
      setFresh(new Set());
    }, 8000);
    return () => clearTimeout(id);
  }, [toasts]);

  if (key === undefined) return <main className="min-h-screen bg-stone-950" />;
  if (!key) return <Setup revoked={revoked} />;

  const stale = offline && lastOk != null;
  return (
    <main className="screen-root flex h-screen flex-col gap-[1.2vw] overflow-hidden bg-stone-950 p-[1.2vw] text-white">
      <style>{SCREEN_CSS}</style>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-[1vw]">
          <LogoMark className="h-[4.5vw] w-[4.5vw]" />
          <div>
            <p className="font-display text-[2.2vw] font-extrabold leading-tight">Zedeka</p>
            <p className="text-[1.05vw] text-stone-400">{view === "compteur" ? t("Activité du jour") : t("Le terrain en direct")}</p>
          </div>
        </div>
        <div className="flex items-center gap-[2vw]">
          {options.mode === "rotation" && (
            <div className="flex gap-2" aria-hidden>
              {(["compteur", "carte"] as const).map((v) => (
                <span key={v} className={`h-2.5 rounded-full transition-all ${view === v ? "w-10 bg-emerald-400" : "w-2.5 bg-white/30"}`} />
              ))}
              {paused && <span className="ml-2 text-[0.9vw] text-stone-400">{t("pause")}</span>}
            </div>
          )}
          <span className={`flex items-center gap-2 rounded-full px-[1vw] py-[0.5vh] text-[1vw] font-semibold ${stale ? "bg-red-500/20 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${stale ? "bg-red-400" : "animate-pulse bg-emerald-400"}`} />
            {stale ? t("Connexion perdue, nouvel essai…") : t("En direct")}
          </span>
          <Clock />
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {!summary ? (
          <div className="grid h-full place-items-center text-[2vw] text-stone-400">{offline ? t("Connexion perdue, nouvel essai…") : t("Chargement…")}</div>
        ) : (
          <>
            <div className={`absolute inset-0 transition-opacity duration-700 ${view === "compteur" ? "opacity-100" : "pointer-events-none opacity-0"}`}>
              <CounterView data={summary} fresh={fresh} />
            </div>
            <div className={`absolute inset-0 transition-opacity duration-700 ${view === "carte" ? "opacity-100" : "pointer-events-none opacity-0"}`}>
              {map && <MapView map={map} summary={summary} fresh={fresh} />}
            </div>
          </>
        )}
      </div>

      {/* Nouvelles commandes */}
      <div className="pointer-events-none fixed bottom-[2vw] left-1/2 z-[900] flex -translate-x-1/2 flex-col items-center gap-[0.8vh]">
        {toasts.map((o) => (
          <div key={o.code} className="screen-toast flex items-center gap-[1vw] rounded-2xl bg-emerald-500 px-[1.6vw] py-[1.2vh] text-[1.6vw] font-bold text-emerald-950 shadow-2xl">
            <span className="text-[2vw]">{o.emoji}</span>
            {t("Nouvelle commande")} · {o.label}
            <span className="font-mono text-[1.2vw] opacity-70">{o.code}</span>
          </div>
        ))}
      </div>

      {/* Fête : palier, objectif ou record */}
      <canvas ref={canvas} className="pointer-events-none fixed inset-0 z-[1000]" />
      {party && (
        <div key={party.id} className="screen-party pointer-events-none fixed inset-0 z-[999] grid place-items-center bg-stone-950/70">
          <div className="text-center">
            <p className="text-[10vw] leading-none">{party.emoji}</p>
            <p className="font-display text-[6vw] font-extrabold text-yellow-300 drop-shadow-lg">{party.title}</p>
            <p className="mt-4 text-[2.2vw] font-semibold text-white">{party.subtitle}</p>
          </div>
        </div>
      )}
    </main>
  );
}

const SCREEN_CSS = `
.screen-root { cursor: none; }
@keyframes screen-pop { 0% { transform: scale(1); } 30% { transform: scale(1.08); color: #fde047; } 100% { transform: scale(1); } }
.screen-pop { animation: screen-pop 900ms ease-out; transform-origin: left bottom; }
@keyframes screen-in { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
.screen-new { animation: screen-in 600ms ease-out; }
@keyframes screen-toast { from { transform: translateY(40px) scale(.9); opacity: 0; } to { transform: none; opacity: 1; } }
.screen-toast { animation: screen-toast 450ms cubic-bezier(.2,.9,.3,1.3); }
@keyframes screen-party { 0% { opacity: 0; transform: scale(.6); } 15% { opacity: 1; transform: scale(1.05); } 25% { transform: scale(1); } 85% { opacity: 1; } 100% { opacity: 0; } }
.screen-party > div { animation: screen-party 7s ease-out forwards; }
@keyframes screen-pulse { 0% { transform: scale(.6); opacity: .55; } 100% { transform: scale(1.6); opacity: 0; } }
.screen-pulse { animation: screen-pulse 2s ease-out infinite; }
.screen-label { background: rgb(12 10 9 / .85); color: #fff; border: 0; border-radius: 8px; font-weight: 700; font-size: 13px; padding: 2px 8px; box-shadow: none; }
.screen-label::before { display: none; }
@media (prefers-reduced-motion: reduce) { .screen-pop, .screen-new, .screen-toast, .screen-pulse { animation: none; } }
`;
