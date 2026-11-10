"use client";

import { useReportWebVitals } from "next/web-vitals";

// Vitesse réelle vue par ce téléphone (Core Web Vitals) : temps de première réponse, premier affichage, plus grand
// élément affiché, réactivité et stabilité. Envoyée en un seul petit lot quand la page passe en arrière-plan, sans
// compte ni numéro : la page (modèle, ex. /r/[slug]), la mesure, la valeur et le type de réseau. Résumé dans
// l'admin, page « Santé ».

type Vital = { page: string; name: string; value: number; connection?: string };
const KEPT = new Set(["LCP", "FCP", "TTFB", "INP", "CLS"]);
const queue: Vital[] = [];

// Les adresses portent des codes et des noms : on ne garde que le modèle de la page.
export function pageTemplate(path: string): string {
  return (
    path
      .replace(/^\/r\/[^/]+/, "/r/[slug]")
      .replace(/^\/commande\/[^/]+/, "/commande/[code]")
      .replace(/^\/t\/[^/]+/, "/t/[token]")
      .replace(/^\/position\/[^/]+/, "/position/[token]")
      .replace(/\/(course|colis|demande|services)\/[^/]+/g, "/$1/[id]")
      .replace(/\/[0-9a-z]{20,}(?=\/|$)/gi, "/[id]")
      .replace(/[^A-Za-z0-9/_[\]-]/g, "")
      .slice(0, 80) || "/"
  );
}

function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, 10);
  try {
    const body = JSON.stringify(batch);
    if (!navigator.sendBeacon?.("/api/vitals", body)) void fetch("/api/vitals", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // Mesure perdue : sans importance.
  }
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  window.addEventListener("pagehide", flush);
}

export default function WebVitals() {
  useReportWebVitals((m) => {
    if (!KEPT.has(m.name)) return;
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
    queue.push({ page: pageTemplate(window.location.pathname), name: m.name, value: m.value, ...(connection ? { connection } : {}) });
    if (queue.length >= 10) flush();
  });
  return null;
}
