"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Hors ligne (planche 7) : savoir quels menus sont gardés sur le téléphone par le service worker, pour griser
// les restaurants dont le menu n'a jamais été ouvert ici.

function subscribe(l: () => void) {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
}

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

// null en ligne ; hors ligne, les adresses des restaurants dont le menu est gardé.
export function useKeptMenus(): Set<string> | null {
  const online = useOnline();
  const [kept, setKept] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (online || !("caches" in window)) return setKept(null);
    let live = true;
    caches
      .open("zedeka-data")
      .then((c) => c.keys())
      .then((keys) => {
        const slugs = keys.map((k) => new URL(k.url).pathname.match(/^\/api\/restaurants\/([^/]+)$/)?.[1]).filter((s): s is string => !!s);
        if (live) setKept(new Set(slugs.map(decodeURIComponent)));
      })
      .catch(() => live && setKept(new Set()));
    return () => {
      live = false;
    };
  }, [online]);
  return kept;
}
