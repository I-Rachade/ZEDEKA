"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useRealtime } from "@/lib/realtime";
import { pageTemplate } from "./WebVitals";

// Écran technique : deux signaux discrets envoyés par chaque appli, sans compte ni numéro.
// - Présence : une connexion temps réel « presence:<appli> » par onglet ouvert, pour compter les utilisateurs en ligne,
//   et l'appareil compté une fois par jour (identifiant tiré au hasard, gardé sur l'appareil ; le serveur n'en garde
//   qu'une empreinte).
// - Plantages d'écran : les erreurs JavaScript non rattrapées (page, message), au plus 5 par page ouverte.

type App = "client" | "livreur" | "restaurant" | "marchand" | "admin";

export function appOf(path: string): App | null {
  if (path.startsWith("/ecran")) return null; // écrans muraux : pas des utilisateurs
  if (path.startsWith("/livreur")) return "livreur";
  if (path.startsWith("/restaurant")) return "restaurant";
  if (path.startsWith("/marchand")) return "marchand";
  if (path.startsWith("/admin")) return "admin";
  return "client";
}

const DEVICE_KEY = "zedeka-device";
function deviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

const MAX_REPORTS = 5;
let reported = 0;
const sent = new Set<string>();

function report(app: App, message: string) {
  if (reported >= MAX_REPORTS) return;
  const page = pageTemplate(window.location.pathname);
  const key = `${page}|${message}`;
  if (sent.has(key)) return;
  sent.add(key);
  reported++;
  try {
    const body = JSON.stringify([{ app, page, message: message.slice(0, 500) }]);
    if (!navigator.sendBeacon?.("/api/client-errors", body)) void fetch("/api/client-errors", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // Signalement perdu : sans importance.
  }
}

export default function TechSignals() {
  const app = appOf(usePathname() ?? "/");

  const ticket = useCallback(async () => {
    if (!app) return null;
    const d = deviceId();
    const res = await fetch(`/api/presence?app=${app}${d ? `&d=${d}` : ""}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { ticket?: string }).ticket ?? null;
  }, [app]);
  useRealtime(app ? ticket : null, app);

  useEffect(() => {
    if (!app) return;
    const onError = (e: ErrorEvent) => {
      // Erreurs de scripts d'autres sites (« Script error. ») : rien d'utile.
      if (!e.message || e.message === "Script error.") return;
      report(app, e.error instanceof Error ? `${e.error.name}: ${e.error.message}` : e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      // Réseau coupé ou requête annulée : courant sur mobile, ce n'est pas un plantage.
      if (r instanceof Error && (r.name === "AbortError" || /Failed to fetch|NetworkError|Load failed/i.test(r.message))) return;
      report(app, r instanceof Error ? `${r.name}: ${r.message}` : `Promesse rejetée : ${String(r).slice(0, 200)}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [app]);

  return null;
}
