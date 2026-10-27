"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { adminFetch, AuthError } from "@/lib/admin";

// Charge une ressource admin et renvoie vers la connexion si le jeton est invalide.
export function useAdmin<T>(path: string) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await adminFetch<T>(path));
      setError(null);
    } catch (e) {
      if (e instanceof AuthError) router.replace("/admin/connexion");
      else setError((e as Error).message);
    }
  }, [path, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, reload };
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
