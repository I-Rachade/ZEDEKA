"use client";

import { useSyncExternalStore } from "react";

// Copie locale des pages des espaces restaurant et admin : à Lomé le courant et Internet coupent souvent.
// Chaque lecture réussie est gardée sur l'appareil ; si le réseau tombe, la page garde ce qu'elle montrait,
// même après un rechargement, avec l'heure de la dernière mise à jour. Effacée à la déconnexion.

const PREFIX = "zedeka.cache.";
// Au-delà, une copie n'est plus montrée (données trop anciennes pour travailler avec).
const MAX_AGE_MS = 24 * 3_600_000;
// Taille maximale d'une copie : une grosse liste n'est pas gardée.
const MAX_BYTES = 200_000;

type Entry<T> = { at: number; data: T };

export function readCache<T>(area: string, path: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${area}:${path}`);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry<T>;
    return Date.now() - e.at < MAX_AGE_MS ? e : null;
  } catch {
    return null;
  }
}

export function writeCache(area: string, path: string, data: unknown) {
  try {
    const raw = JSON.stringify({ at: Date.now(), data });
    if (raw.length <= MAX_BYTES) localStorage.setItem(`${PREFIX}${area}:${path}`, raw);
  } catch {
    // stockage plein ou indisponible : la page fonctionne sans copie
  }
}

export function clearCache(area: string) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(`${PREFIX}${area}:`)) localStorage.removeItem(k);
  } catch {
    // rien à effacer
  }
}

// État du réseau partagé par les pages : hors ligne quand le navigateur le dit, ou quand une lecture vient
// d'échouer faute de réponse ; l'heure de la dernière lecture réussie sert au bandeau.
type Net = { offline: boolean; lastOk: number | null };
let net: Net = { offline: false, lastOk: null };
const listeners = new Set<() => void>();
const emit = (next: Partial<Net>) => {
  net = { ...net, ...next };
  listeners.forEach((l) => l());
};
export const markOk = () => emit({ offline: false, lastOk: Date.now() });
export const markFailed = () => emit({ offline: true });
// Une réponse d'erreur de l'API (403, 404…) prouve que le réseau marche ; seul l'échec de fetch signale la coupure.
export const isNetworkError = (e: unknown) => e instanceof TypeError;

function subscribe(l: () => void) {
  listeners.add(l);
  const off = () => emit({ offline: true });
  const on = () => emit({ offline: false });
  window.addEventListener("offline", off);
  window.addEventListener("online", on);
  if (!navigator.onLine && !net.offline) queueMicrotask(off);
  return () => {
    listeners.delete(l);
    window.removeEventListener("offline", off);
    window.removeEventListener("online", on);
  };
}
const SERVER: Net = { offline: false, lastOk: null };
export const useNetwork = () => useSyncExternalStore(subscribe, () => net, () => SERVER);
