"use client";

import { useEffect, useSyncExternalStore } from "react";

// Profil > Économie (planche 7) : économie de batterie (automatique sous 20 %, ou forcée) et données réduites (sans
// photos des plats ni carte en direct). Les réglages restent sur le téléphone ; la page les lit par des classes sur
// <html> : « eco » (pas d'animation) et « lite » (sans photos).

export type EcoSettings = { battery: "AUTO" | "ON" | "OFF"; lite: boolean };
type State = EcoSettings & { level: number | null; charging: boolean };

const KEY = "zedeka.eco";
const DEFAULT: EcoSettings = { battery: "AUTO", lite: false };
let state: State = { ...DEFAULT, level: null, charging: false };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    state = { ...state, ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<EcoSettings>) };
  } catch {
    // Réglages illisibles : valeurs par défaut.
  }
  type Battery = EventTarget & { level: number; charging: boolean };
  const nav = navigator as Navigator & { getBattery?: () => Promise<Battery> };
  nav
    .getBattery?.()
    .then((b) => {
      const update = () => set({ level: b.level, charging: b.charging });
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    })
    .catch(() => {});
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  apply();
  listeners.forEach((l) => l());
}

export function saveEco(patch: Partial<EcoSettings>) {
  load();
  set(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify({ battery: state.battery, lite: state.lite }));
  } catch {
    // Pas de stockage : le réglage vaut pour cette visite.
  }
}

// Économie active : forcée, ou automatique sous 20 % hors charge.
export const batterySaving = (s: State) => s.battery === "ON" || (s.battery === "AUTO" && s.level !== null && s.level < 0.2 && !s.charging);

function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("eco", batterySaving(state));
  document.documentElement.classList.toggle("lite", state.lite);
}

export function useEco() {
  const s = useSyncExternalStore(
    (l) => {
      load();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  return s;
}

// Monté une fois par l'appli client : applique les classes dès l'ouverture.
export function useApplyEco() {
  useEffect(() => {
    load();
    apply();
  }, []);
}
