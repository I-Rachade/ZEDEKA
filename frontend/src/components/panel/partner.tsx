"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createAlertChannel, FirebaseMessaging, isNativeApp, nativePlatform } from "@/lib/native";
import { Icon } from "./icons";

// Outils de l'espace restaurant : alarme de commande, écran allumé, notifications,
// ouvert/fermé. Chaque espace fournit son client d'API.

export type PartnerClient = {
  area: string;
  base: string; // /restaurant
  apiFetch: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
  saveSession: (token: string, name?: string) => void;
  logout: () => void;
};

// --- Écran allumé tant que l'espace est ouvert (Wake Lock, si le navigateur le permet) ---

type Sentinel = { release: () => Promise<void> };

export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };
    if (!enabled || !nav.wakeLock) return;
    let lock: Sentinel | null = null;
    const acquire = () => {
      if (document.visibilityState === "visible") nav.wakeLock?.request("screen").then((l) => (lock = l), () => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}

// --- Alarme : sonnerie en boucle jusqu'à ce que le partenaire ouvre la commande ---

function ring(ctx: AudioContext) {
  [0, 0.18, 0.36, 0.7, 0.88, 1.06].forEach((start, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = i % 2 ? 988 : 784;
    gain.gain.setValueAtTime(0.18, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + 0.16);
  });
}

// Les navigateurs n'autorisent le son qu'après un geste : on prépare le contexte audio au premier toucher.
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume().catch(() => {});
  } catch {
    // son indisponible
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockAudio, { capture: true });
  window.addEventListener("keydown", unlockAudio, { capture: true });
}

// Sonne et vibre toutes les 2,5 s tant que « ringing » ; indique si le navigateur bloque encore le son.
export function useRinging(ringing: boolean) {
  const [soundBlocked, setSoundBlocked] = useState(false);
  useEffect(() => {
    if (!ringing) return;
    const play = () => {
      unlockAudio();
      if (!audio || audio.state !== "running") {
        setSoundBlocked(true);
        return;
      }
      setSoundBlocked(false);
      ring(audio);
      navigator.vibrate?.([400, 200, 400]);
    };
    play();
    const t = setInterval(play, 2500);
    return () => clearInterval(t);
  }, [ringing]);
  return soundBlocked;
}

export function OrderAlarm({ area, pending, label, onView }: { area: string; pending: number; label: (n: number) => string; onView: () => void }) {
  // L'alarme se déclenche dès qu'il y a plus de commandes en attente que lors du dernier « Voir »
  // (retenu pour l'onglet, pour ne pas resonner à chaque rechargement).
  const key = `zedeka-${area}-alarm-seen`;
  const [seen, setSeenState] = useState(() => {
    try {
      return Number(sessionStorage.getItem(key) ?? 0);
    } catch {
      return 0;
    }
  });
  const setSeen = useCallback(
    (n: number) => {
      setSeenState(n);
      try {
        sessionStorage.setItem(key, String(n));
      } catch {
        // stockage indisponible
      }
    },
    [key],
  );
  const ringing = pending > seen;
  const soundBlocked = useRinging(ringing);

  useEffect(() => {
    if (pending < seen) setSeen(pending);
  }, [pending, seen, setSeen]);

  if (!ringing) return null;
  return (
    <div role="alertdialog" aria-label={label(pending)} className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-emerald-700 p-6 text-center text-white">
      <span className="relative grid h-24 w-24 place-items-center rounded-full bg-sun text-ink">
        <span className="anim-wave absolute inset-0 rounded-full border-4 border-sun" aria-hidden="true" />
        <Icon name="bell" className="anim-shake h-12 w-12" />
      </span>
      <div>
        <p className="text-3xl font-bold">{label(pending)}</p>
        <p className="mt-2 text-emerald-100">Ouvrez-la pour l&apos;accepter : le client attend votre réponse.</p>
      </div>
      {soundBlocked && <p className="rounded-lg bg-white/15 px-3 py-2 text-sm">Touchez l&apos;écran une fois pour activer la sonnerie.</p>}
      <button
        onClick={() => {
          setSeen(pending);
          onView();
        }}
        className="w-full max-w-xs rounded-2xl bg-white px-6 py-4 text-lg font-bold text-emerald-800 shadow-lg"
      >
        Voir
      </button>
    </div>
  );
}

// --- Notifications : Web Push dans le navigateur, Firebase dans les applications Android et iOS ---

function base64ToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // stockage indisponible : les alertes se réactiveront à la prochaine ouverture
  }
}

export type PushState = "unsupported" | "denied" | "off" | "on" | "loading";

export function usePush(api: Pick<PartnerClient, "apiFetch">) {
  const [state, setState] = useState<PushState>("loading");
  const [devices, setDevices] = useState<number | null>(null);
  const native = isNativeApp();
  const offKey = "zedeka.nativePushOff";

  // Application Android ou iOS : jeton Firebase, réenregistré à chaque ouverture (il peut changer).
  const registerNative = useCallback(async () => {
    await createAlertChannel();
    const { token } = await FirebaseMessaging.getToken();
    const r = await api.apiFetch<{ devices: number }>("/push/native", { method: "POST", body: { token, platform: nativePlatform() } });
    setDevices(r.devices);
  }, [api]);

  const refresh = useCallback(async () => {
    if (native) {
      try {
        const { receive } = await FirebaseMessaging.checkPermissions();
        if (receive === "denied") return setState("denied");
        if (receive !== "granted" || readFlag(offKey)) return setState("off");
        await registerNative();
        setState("on");
      } catch {
        setState("unsupported");
      }
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub && Notification.permission === "granted" ? "on" : "off");
    api.apiFetch<{ devices: number }>("/push").then((r) => setDevices(r.devices), () => {});
  }, [api, native, registerNative]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setState("loading");
    try {
      if (native) {
        const { receive } = await FirebaseMessaging.requestPermissions();
        if (receive !== "granted") {
          setState(receive === "denied" ? "denied" : "off");
          return false;
        }
        writeFlag(offKey, false);
        await registerNative();
        setState("on");
        return true;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return false;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const { publicKey } = await api.apiFetch<{ publicKey: string }>("/push/key");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) }));
      const r = await api.apiFetch<{ devices: number }>("/push", { method: "POST", body: sub.toJSON() });
      setDevices(r.devices);
      setState("on");
      return true;
    } catch {
      setState("off");
      return false;
    }
  }, [api, native, registerNative]);

  const disable = useCallback(async () => {
    if (native) {
      const token = await FirebaseMessaging.getToken().then((t) => t.token, () => "");
      if (token) await api.apiFetch("/push", { method: "DELETE", body: { endpoint: `fcm:${token}` } }).catch(() => {});
      await FirebaseMessaging.deleteToken().catch(() => {});
      writeFlag(offKey, true);
      // L'autorisation reste donnée au système : les alertes sont coupées tant qu'on ne les réactive pas.
      setState("off");
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api.apiFetch("/push", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
    refresh();
  }, [api, native, refresh]);

  const test = useCallback(() => api.apiFetch<{ sent: number }>("/push/test", { method: "POST" }), [api]);

  return { state, devices, enable, disable, test, refresh };
}

// Proposé au premier démarrage, tant que les alertes ne sont ni activées ni refusées sur cet appareil.
export function PushBanner({ api, what }: { api: PartnerClient; what: string }) {
  const push = usePush(api);
  const key = `zedeka-${api.area}-push-asked`;
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(key) === "1");
    } catch {
      setDismissed(false);
    }
  }, [key]);
  const dismiss = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      // stockage indisponible : la proposition reviendra
    }
    setDismissed(true);
  };
  if (dismissed || push.state !== "off") return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
      <Icon name="bell" className="h-5 w-5 shrink-0 text-emerald-700" />
      <p className="min-w-48 flex-1">Recevez une alerte pour chaque {what}, même quand cette page est fermée.</p>
      <button onClick={() => push.enable().then(dismiss)} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white">
        Activer les alertes
      </button>
      <button onClick={dismiss} className="px-2 py-1.5 text-emerald-800">
        Plus tard
      </button>
    </div>
  );
}

// --- Ouvert / fermé, avec durée ---

const DURATIONS = [
  { value: "30m", label: "30 minutes" },
  { value: "1h", label: "1 heure" },
  { value: "tomorrow", label: "Jusqu'à demain matin" },
  { value: "indefinite", label: "Jusqu'à réouverture" },
] as const;

export type OpenState = { temporarilyClosed: boolean; closedUntil: string | null };

export function isClosed(s: OpenState, now = Date.now()) {
  return s.temporarilyClosed && (!s.closedUntil || new Date(s.closedUntil).getTime() > now);
}

const hour = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });

export function OpenSwitch({ api, state, onChange }: { api: PartnerClient; state: OpenState | null; onChange: () => void }) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  if (!state) return null;
  const closed = isClosed(state);

  async function set(open: boolean, duration?: string) {
    setBusy(true);
    try {
      await api.apiFetch("/status", { method: "PATCH", body: { open, duration } });
      onChange();
      window.dispatchEvent(new Event("zedeka:status-changed"));
    } finally {
      setBusy(false);
      setMenu(false);
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setMenu((m) => !m)}
        disabled={busy}
        aria-haspopup="menu"
        className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${closed ? "bg-stone-200 text-stone-700" : "bg-emerald-100 text-emerald-800"}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${closed ? "bg-stone-500" : "bg-emerald-500"}`} />
        {closed ? "Fermé" : "Ouvert"}
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-64 rounded-xl border border-stone-200 bg-white p-1 text-sm shadow-lg">
          {closed ? (
            <>
              <p className="px-3 py-2 text-xs text-stone-500">{state.closedUntil ? `Fermé jusqu'à ${hour(state.closedUntil)}` : "Fermé jusqu'à réouverture"}</p>
              <button role="menuitem" onClick={() => set(true)} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-emerald-700 hover:bg-stone-100">
                Rouvrir maintenant
              </button>
            </>
          ) : (
            <>
              <p className="px-3 py-2 text-xs text-stone-500">Fermer temporairement (les horaires restent valables)</p>
              {DURATIONS.map((d) => (
                <button key={d.value} role="menuitem" onClick={() => set(false, d.value)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-stone-100">
                  {d.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
