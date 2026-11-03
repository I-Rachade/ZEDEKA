"use client";

import { useEffect, useState } from "react";
import { apiGet } from "./api";

// Mode Zed ouvert aux clients (Réglages de l'admin) : lu une fois par chargement de l'application.
let cached: Promise<boolean> | null = null;
export function useZedEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    cached ??= apiGet<{ enabled: boolean }>("/api/zed/config")
      .then((c) => Boolean(c?.enabled))
      .catch(() => false);
    let live = true;
    cached.then((v) => live && setEnabled(v));
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}
