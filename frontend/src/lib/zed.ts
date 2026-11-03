"use client";

import { useEffect, useState } from "react";
import { apiGet } from "./api";

export type ZedColor = "SUN" | "GREEN" | "CORAL" | "INK";
// Couleurs du bouton Zed de la barre (Réglages de l'admin) : fond, moto et libellé.
export const ZED_COLORS: Record<ZedColor, { label: string; button: string; text: string }> = {
  SUN: { label: "Jaune Zedeka", button: "bg-sun text-ink", text: "text-ink" },
  GREEN: { label: "Vert Zedeka", button: "bg-emerald-600 text-white", text: "text-emerald-700" },
  CORAL: { label: "Corail", button: "bg-coral text-white", text: "text-coral" },
  INK: { label: "Vert foncé", button: "bg-ink text-sun", text: "text-ink" },
};

type ZedConfig = { enabled: boolean; color: ZedColor };
const OFF: ZedConfig = { enabled: false, color: "SUN" };

// Mode Zed ouvert aux clients et couleur du bouton : lus une fois par chargement de l'application.
let cached: Promise<ZedConfig> | null = null;
export function useZedConfig(): ZedConfig {
  const [config, setConfig] = useState<ZedConfig>(OFF);
  useEffect(() => {
    cached ??= apiGet<Partial<ZedConfig>>("/api/zed/config")
      .then((c) => ({ enabled: Boolean(c?.enabled), color: c?.color && c.color in ZED_COLORS ? c.color : "SUN" }))
      .catch(() => OFF);
    let live = true;
    cached.then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}
