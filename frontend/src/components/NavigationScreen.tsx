"use client";

import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/panel/icons";
import { driverFetch } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { MAP_ATTRIBUTION, MAP_TILES } from "@/lib/mapTiles";
import {
  ARRIVED_M,
  arrowAngle,
  bearing,
  fmtDistance,
  instruction,
  metersBetween,
  OFF_ROUTE_M,
  prepareRoute,
  progress,
  REROUTE_EVERY_MS,
  type LatLng,
  type PreparedRoute,
  type Progress,
  type Route,
} from "@/lib/nav";

type Fix = LatLng & { heading: number | null; accuracy: number };

const VOICE_KEY = "zedeka-nav-voice";
const readVoice = () => {
  try {
    return localStorage.getItem(VOICE_KEY) !== "0";
  } catch {
    return true;
  }
};

const ARROW = (deg: number) =>
  `<span style="display:grid;place-items:center;width:44px;height:44px;border-radius:9999px;background:rgb(4 120 87 / .18)"><svg width="30" height="30" viewBox="0 0 24 24" style="transform:rotate(${deg}deg)"><path d="M12 2 20 21 12 16.5 4 21z" fill="#047857" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></span>`;
const PIN =
  '<svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 0C7.6 0 0 7.4 0 16.6 0 29 17 44 17 44s17-15 17-27.4C34 7.4 26.4 0 17 0z" fill="#e5484d"/><circle cx="17" cy="16" r="6.5" fill="#fff"/></svg>';

// Flèche de la prochaine manœuvre, dans le bandeau du haut.
function TurnIcon({ angle }: { angle: number | null }) {
  if (angle === null)
    return (
      <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 21v-5M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM15 9l3-3M18 6h-3M18 6v3" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" style={{ transform: `rotate(${angle}deg)` }} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21V4M5 11l7-7 7 7" />
    </svg>
  );
}

// Écran « Naviguer » : carte Zedeka plein écran, tracé jusqu'à l'arrivée, position du livreur en direct, prochaine
// manœuvre (dite à voix haute si la voix est active), temps et distance restants. Recalcule seul si le livreur quitte
// l'itinéraire. Sans service d'itinéraire, trace une ligne droite. Google Maps reste en secours.
export default function NavigationScreen({ to, label, fallbackUrl, onClose }: { to: LatLng; label: string; fallbackUrl: string; onClose: () => void }) {
  const { t, lang, locale } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<{ map: LeafletMap; L: typeof import("leaflet"); me?: Marker; ahead?: Polyline; casing?: Polyline } | null>(null);
  const [ready, setReady] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState(false);
  const [route, setRoute] = useState<PreparedRoute | null>(null);
  const [routeFailed, setRouteFailed] = useState(false);
  const [follow, setFollow] = useState(true);
  const [voice, setVoice] = useState(readVoice);
  const lastFetch = useRef(0);
  const offCount = useRef(0);
  const fetching = useRef(false);
  const spoken = useRef<{ step: number | null; near: boolean }>({ step: -1, near: false });

  // Position GPS en continu ; le cap vient du téléphone, ou se déduit de deux positions successives.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGpsError(true);
      return;
    }
    let prev: LatLng | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const here = { latitude: p.coords.latitude, longitude: p.coords.longitude };
        let heading = p.coords.heading != null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 0.5 ? p.coords.heading : null;
        if (heading === null && prev && metersBetween(prev, here) > 8) heading = bearing(prev, here);
        if (!prev || metersBetween(prev, here) > 8) prev = here;
        setFix((f) => ({ ...here, accuracy: p.coords.accuracy, heading: heading ?? f?.heading ?? null }));
        setGpsError(false);
      },
      () => setGpsError(true),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Écran allumé pendant la navigation.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const ask = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (document.visibilityState === "visible" && nav.wakeLock) lock = await nav.wakeLock.request("screen");
      } catch {
        // Refusé (économie d'énergie) : la navigation continue.
      }
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      document.removeEventListener("visibilitychange", ask);
      lock?.release().catch(() => {});
    };
  }, []);

  const loadRoute = useCallback(
    async (from: LatLng) => {
      if (fetching.current) return;
      fetching.current = true;
      lastFetch.current = Date.now();
      try {
        const q = `from=${from.latitude.toFixed(6)},${from.longitude.toFixed(6)}&to=${to.latitude.toFixed(6)},${to.longitude.toFixed(6)}`;
        const r = await driverFetch<Route>(`/route?${q}`);
        setRoute(r.line.length > 1 ? prepareRoute(r) : null);
        setRouteFailed(r.line.length <= 1);
        offCount.current = 0;
        spoken.current = { step: -1, near: false };
      } catch {
        setRouteFailed(true);
      } finally {
        fetching.current = false;
      }
    },
    [to.latitude, to.longitude],
  );

  // Premier itinéraire dès la première position.
  const hasFix = fix !== null;
  useEffect(() => {
    if (hasFix && fix && !route && !routeFailed) loadRoute(fix);
    // Seulement à l'arrivée de la première position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFix]);

  const prog: Progress | null = route && fix ? progress(route, fix) : null;
  const straightM = fix ? metersBetween(fix, to) : null;
  const remainingM = prog ? prog.remainingM : straightM;
  const arrived = straightM !== null && straightM < Math.max(ARRIVED_M, Math.min(fix?.accuracy ?? 0, 60));
  const nextStep = prog && prog.next !== null && route ? route.steps[prog.next] : null;

  // Hors du tracé deux fois de suite : nouvel itinéraire depuis la position actuelle (pas plus d'une fois toutes les 15 s).
  // Service en panne : nouvel essai toutes les 15 s.
  useEffect(() => {
    if (!fix || arrived) return;
    const due = Date.now() - lastFetch.current > REROUTE_EVERY_MS;
    if (routeFailed) {
      if (due) loadRoute(fix);
      return;
    }
    if (!prog) return;
    if (prog.offRouteM > Math.max(OFF_ROUTE_M, Math.min(fix.accuracy, 80))) offCount.current += 1;
    else offCount.current = 0;
    if (offCount.current >= 2 && due) loadRoute(fix);
  }, [fix, prog, routeFailed, arrived, loadRoute]);

  // Voix : annonce chaque nouvelle manœuvre, puis la répète à l'approche.
  const say = useCallback(
    (text: string) => {
      if (!voice || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = locale;
      u.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    },
    [voice, locale],
  );
  useEffect(() => {
    if (!prog || !route) return;
    if (arrived) {
      if (spoken.current.step !== -2) say(t("Vous êtes arrivé"));
      spoken.current = { step: -2, near: true };
      return;
    }
    const step = prog.next;
    if (step === null) return;
    const text = instruction(route.steps[step], t);
    if (spoken.current.step !== step) {
      spoken.current = { step, near: prog.toNextM < 80 };
      say(prog.toNextM < 80 ? text : t("Dans {d}, {action}", { d: fmtDistance(prog.toNextM, lang), action: text.charAt(0).toLowerCase() + text.slice(1) }));
    } else if (!spoken.current.near && prog.toNextM < 60) {
      spoken.current.near = true;
      say(text);
    }
  }, [prog, route, arrived, say, t, lang]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  // Carte : posée une fois, avec l'arrivée.
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([to.latitude, to.longitude], 16);
      L.tileLayer(MAP_TILES, { maxZoom: 19, attribution: MAP_ATTRIBUTION }).addTo(m);
      L.marker([to.latitude, to.longitude], { icon: L.divIcon({ html: PIN, className: "", iconSize: [34, 44], iconAnchor: [17, 44] }), interactive: false }).addTo(m);
      // Le livreur déplace la carte : on arrête de la recentrer jusqu'à « Recentrer ».
      m.on("dragstart", () => setFollow(false));
      map.current = { map: m, L };
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.map.remove();
      map.current = null;
    };
  }, [to.latitude, to.longitude]);

  // Tracé restant : du point du livreur sur la route jusqu'à l'arrivée.
  useEffect(() => {
    const s = map.current;
    if (!s) return;
    const { L } = s;
    let pts: [number, number][] = [];
    if (route && prog) {
      const i = route.cum.findIndex((c) => c > prog.doneM);
      pts = [[prog.snapped.latitude, prog.snapped.longitude], ...route.line.slice(i < 0 ? route.line.length : i)];
    } else if (route) pts = route.line;
    else if (fix) pts = [[fix.latitude, fix.longitude], [to.latitude, to.longitude]];
    if (!s.casing) s.casing = L.polyline(pts, { color: "#fff", weight: 11, opacity: 0.9, lineCap: "round", lineJoin: "round" }).addTo(s.map);
    else s.casing.setLatLngs(pts);
    const dashed = !route;
    if (!s.ahead) s.ahead = L.polyline(pts, { color: "#047857", weight: 7, lineCap: "round", lineJoin: "round", dashArray: dashed ? "2 12" : undefined }).addTo(s.map);
    else {
      s.ahead.setLatLngs(pts);
      s.ahead.setStyle({ dashArray: dashed ? "2 12" : "" });
    }
  }, [ready, route, prog, fix, to.latitude, to.longitude]);

  // Livreur : flèche orientée, carte recentrée devant lui.
  useEffect(() => {
    const s = map.current;
    if (!s || !fix) return;
    const { L } = s;
    const icon = L.divIcon({ html: ARROW(fix.heading ?? 0), className: "", iconSize: [44, 44], iconAnchor: [22, 22] });
    if (!s.me) s.me = L.marker([fix.latitude, fix.longitude], { icon, interactive: false, zIndexOffset: 1000 }).addTo(s.map);
    else {
      s.me.setLatLng([fix.latitude, fix.longitude]);
      s.me.setIcon(icon);
    }
    if (follow) s.map.setView([fix.latitude, fix.longitude], Math.max(s.map.getZoom(), 16), { animate: true });
  }, [ready, fix, follow]);

  function overview() {
    const s = map.current;
    if (!s) return;
    setFollow(false);
    const pts = (route?.line ?? []).map(([a, b]) => s.L.latLng(a, b));
    if (fix) pts.push(s.L.latLng(fix.latitude, fix.longitude));
    pts.push(s.L.latLng(to.latitude, to.longitude));
    s.map.fitBounds(s.L.latLngBounds(pts), { padding: [60, 60], maxZoom: 17 });
  }

  function toggleVoice() {
    const next = !voice;
    setVoice(next);
    try {
      localStorage.setItem(VOICE_KEY, next ? "1" : "0");
    } catch {
      // Réglage gardé pour cette navigation seulement.
    }
    if (!next) window.speechSynthesis?.cancel();
  }

  const minutes = prog ? Math.max(1, Math.round(prog.remainingS / 60)) : straightM !== null ? Math.max(1, Math.round(((straightM * 1.35) / 1000) * 3.4)) : null; // détours ≈ +35 %, moto ≈ 18 km/h
  const eta = minutes !== null ? new Date(Date.now() + minutes * 60_000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" }) : null;

  const banner = arrived
    ? { angle: null as number | null, title: t("Vous êtes arrivé"), sub: label }
    : gpsError && !fix
      ? { angle: 0, title: t("Position GPS indisponible"), sub: t("Activez la localisation du téléphone, ou ouvrez Google Maps.") }
      : !fix
        ? { angle: 0, title: t("Recherche de votre position…"), sub: label }
        : nextStep && prog
          ? { angle: arrowAngle(nextStep), title: fmtDistance(prog.toNextM, lang), sub: instruction(nextStep, t) }
          : route && prog
            ? { angle: 0, title: fmtDistance(prog.remainingM, lang), sub: t("Continuez jusqu'à l'arrivée") }
            : { angle: fix && straightM !== null ? Math.round(bearing(fix, to) - (fix.heading ?? 0)) : 0, title: fmtDistance(straightM ?? 0, lang), sub: routeFailed ? t("Itinéraire indisponible : suivez la flèche vers l'arrivée") : t("Calcul de l'itinéraire…") };

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex flex-col bg-stone-200 [&_.leaflet-bottom]:!bottom-[168px]" role="dialog" aria-modal="true" aria-label={t("Navigation vers {place}", { place: label })}>
      <div ref={box} className="absolute inset-0" data-noswipe />

      <div className="relative z-[500] m-3 mt-[calc(0.75rem+env(safe-area-inset-top))] flex items-center gap-3 rounded-2xl bg-emerald-700 p-3 text-white shadow-lg">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-emerald-800">
          {arrived ? <span className="text-3xl" aria-hidden="true">🏁</span> : <TurnIcon angle={banner.angle} />}
        </div>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-[26px] font-bold leading-tight tabular-nums">{banner.title}</p>
          <p className="truncate text-[15px] text-emerald-50">{banner.sub}</p>
        </div>
        <button onClick={toggleVoice} aria-pressed={voice} aria-label={voice ? t("Couper la voix") : t("Activer la voix")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-800 text-xl">
          <span aria-hidden="true">{voice ? "🔊" : "🔇"}</span>
        </button>
      </div>

      <div className="relative z-[500] mx-3 flex justify-end gap-2">
        <button onClick={overview} className="rounded-full bg-surface px-4 py-2 text-[14px] font-semibold shadow">
          {t("Vue d'ensemble")}
        </button>
        {!follow && (
          <button onClick={() => setFollow(true)} className="rounded-full bg-surface px-4 py-2 text-[14px] font-semibold text-emerald-700 shadow">
            {t("Recentrer")}
          </button>
        )}
      </div>

      <div className="relative z-[500] mt-auto rounded-t-[18px] bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-[0_-4px_20px_rgb(0_0_0/0.12)]">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[28px] font-bold leading-none tabular-nums">
              {minutes ?? "–"} <span className="text-[15px] font-medium">min</span>
            </p>
            <p className="mt-1 text-[14px] text-stone-600 tabular-nums">
              {remainingM !== null ? fmtDistance(remainingM, lang) : "–"}
              {eta ? ` · ${t("arrivée {time}", { time: eta })}` : ""}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[12px] text-stone-500">{t("Vers")}</p>
            <p className="truncate text-[15px] font-semibold">{label}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <button onClick={onClose} className="rounded-[10px] bg-emerald-600 py-3 text-[16px] font-bold text-white">
            {arrived ? t("Terminer") : t("Quitter la navigation")}
          </button>
          <a href={fallbackUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-[10px] border border-stone-200 px-4 py-3 text-[14px] font-semibold text-stone-700">
            <Icon name="map" className="h-4 w-4" /> Google Maps
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
