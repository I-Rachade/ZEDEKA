"use client";

import { useEffect, useRef, useState } from "react";
import type { PanelTableCall } from "@/lib/restaurant";

// Pouls de l'espace restaurant (GET /api/restaurant/pulse), lu par le cadre (RestaurantShell) toutes les 5 s :
// compteurs du menu, appels des tables et une empreinte « version » des commandes en cours. Les écrans ne relisent
// leurs listes que quand la version change, au lieu d'avoir chacun leur minuterie (moins de requêtes simultanées
// vers la base : c'est ce qui provoquait les « Erreur 500 »).

export type PulseCounts = Record<"PENDING" | "CONFIRMED" | "PREPARING" | "READY", number>;
export type Pulse = { counts: PulseCounts; version: string; calls: PanelTableCall[] };

const EVENT = "zedeka:pulse";
const REFRESH = "zedeka:pulse-refresh";
let last: Pulse | null = null;

export function publishPulse(p: Pulse) {
  last = p;
  window.dispatchEvent(new CustomEvent<Pulse>(EVENT, { detail: p }));
}

// Demande au cadre de relire le pouls tout de suite (après un geste : « J'arrive », commande acceptée…).
export const refreshPulse = () => window.dispatchEvent(new Event(REFRESH));

export function onPulseRefresh(fn: () => void) {
  window.addEventListener(REFRESH, fn);
  return () => window.removeEventListener(REFRESH, fn);
}

// Dernier pouls reçu, mis à jour à chaque lecture.
export function usePulse(): Pulse | null {
  const [p, setP] = useState<Pulse | null>(last);
  useEffect(() => {
    const on = (e: Event) => setP((e as CustomEvent<Pulse>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return p;
}

// Appelle fn quand les commandes en cours ont changé (pas au premier pouls : l'écran vient de charger ses données).
// Filet de sécurité : relecture toutes les `fallbackMs` quand même (position du livreur, minutes écoulées).
export function useOnOrdersChanged(fn: () => void, fallbackMs = 60_000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let seen = last?.version ?? null;
    const on = (e: Event) => {
      const { version } = (e as CustomEvent<Pulse>).detail;
      if (seen !== null && version !== seen) ref.current();
      seen = version;
    };
    window.addEventListener(EVENT, on);
    const timer = setInterval(() => ref.current(), fallbackMs);
    return () => {
      window.removeEventListener(EVENT, on);
      clearInterval(timer);
    };
  }, [fallbackMs]);
}
