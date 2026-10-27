"use client";

import { useSyncExternalStore } from "react";

// Données gardées sur l'appareil du client (session, panier, adresse choisie, dernières commandes).
// localStorage peut être indisponible (navigation privée) : on retombe alors sur « rien d'enregistré ».

const EVENT = "zedeka-storage";

export function readStored<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible : la valeur ne survivra pas au rechargement
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const raw = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const cache = new Map<string, { raw: string | null; value: unknown }>();

// Valeur enregistrée, relue quand elle change (y compris depuis un autre onglet). Null côté serveur.
export function useStored<T>(key: string): T | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const current = raw(key);
      const hit = cache.get(key);
      if (hit && hit.raw === current) return hit.value as T | null;
      let value: T | null = null;
      try {
        value = current ? (JSON.parse(current) as T) : null;
      } catch {
        // valeur illisible : traitée comme absente
      }
      cache.set(key, { raw: current, value });
      return value;
    },
    () => null,
  );
}

// Vrai une fois la page hydratée : évite d'afficher l'état « non connecté » avant d'avoir lu l'appareil.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// Commandes passées depuis cet appareil, pour les suivre sans compte.
export type RecentOrder = { kind: "FOOD" | "PARCEL" | "RENTAL"; code: string; at: string };

export const RECENT_KEY = "zedeka.recent";
export const FIRST_ORDER_KEY = "zedeka.ordered";

export function rememberOrder(kind: RecentOrder["kind"], code: string) {
  const list = readStored<RecentOrder[]>(RECENT_KEY) ?? [];
  writeStored(RECENT_KEY, [{ kind, code, at: new Date().toISOString() }, ...list.filter((o) => o.code !== code)].slice(0, 10));
  writeStored(FIRST_ORDER_KEY, true);
}

export const trackHref = (kind: RecentOrder["kind"], code: string) => (kind === "RENTAL" ? `/reservation/${code}` : `/commande/${code}`);
