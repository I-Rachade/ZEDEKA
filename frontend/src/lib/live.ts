"use client";

import { useEffect, useRef } from "react";
import { onForegroundNotification } from "@/lib/native";

// Mises à jour « en direct » d'un écran de suivi, sans attendre le prochain tour de rafraîchissement :
// - une notification reçue alors que l'application est ouverte (Firebase dans les applications, Web Push via le
//   service worker dans le navigateur) déclenche aussitôt une relecture ;
// - le retour sur l'écran (onglet, application remise au premier plan, réseau revenu) aussi ;
// - et, entre les deux, une relecture légère toutes les `every` ms tant que l'écran est visible.
export function useLiveRefresh(check: () => void, { every = 4000, enabled = true }: { every?: number; enabled?: boolean } = {}) {
  const ref = useRef(check);
  ref.current = check;

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    const timer = setInterval(run, every);
    const onVisible = () => run();
    const onMessage = (e: MessageEvent) => e.data?.type === "zedeka-push" && ref.current();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const stopNative = onForegroundNotification(() => ref.current());
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      stopNative();
    };
  }, [every, enabled]);
}
