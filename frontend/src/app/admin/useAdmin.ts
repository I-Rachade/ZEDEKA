"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isNetworkError, markFailed, markOk, readCache, writeCache } from "@/lib/panelCache";
import { adminFetch, AuthError } from "@/lib/admin";

// Charge une ressource admin et renvoie vers la connexion si le jeton est invalide.
export function useAdmin<T>(path: string) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Heure de la copie locale montrée faute de réseau (null : données fraîches).
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const fresh = await adminFetch<T>(path);
      setData(fresh);
      setSavedAt(null);
      setError(null);
      markOk();
      writeCache("admin", path, fresh);
    } catch (e) {
      if (e instanceof AuthError) return router.replace("/admin/connexion");
      // Réseau coupé : on garde ce qui est à l'écran, ou la dernière copie gardée sur l'appareil.
      if (isNetworkError(e)) {
        markFailed();
        const kept = readCache<T>("admin", path);
        if (kept) {
          setData((d) => d ?? kept.data);
          setSavedAt((s) => s ?? kept.at);
          return;
        }
      }
      setError((e as Error).message);
    }
  }, [path, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Au retour du réseau, la page se recharge seule.
  useEffect(() => {
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, [reload]);

  return { data, error, reload, savedAt };
}

// Exécute une écriture et renvoie un message d'erreur lisible.
export function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        setError(null);
        await fn();
        return true;
      } catch (e) {
        if (e instanceof AuthError) router.replace("/admin/connexion");
        else setError((e as Error).message);
        return false;
      }
    },
    [router],
  );
  return { error, run };
}
