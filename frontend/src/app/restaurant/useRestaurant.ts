"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AuthError, restaurantFetch } from "@/lib/restaurant";

// Charge une ressource de l'espace restaurant ; renvoie vers la connexion si la session a expiré.
export function useRestaurant<T>(path: string) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await restaurantFetch<T>(path));
      setError(null);
    } catch (e) {
      if (e instanceof AuthError) router.replace("/restaurant/connexion");
      else setError((e as Error).message);
    }
  }, [path, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, reload };
}

export function useRestaurantAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        setError(null);
        await fn();
        return true;
      } catch (e) {
        if (e instanceof AuthError) router.replace("/restaurant/connexion");
        else setError((e as Error).message);
        return false;
      }
    },
    [router],
  );
  return { error, run };
}
