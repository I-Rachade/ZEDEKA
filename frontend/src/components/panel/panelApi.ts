"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { AuthError } from "@/lib/admin";

// Client d'un espace partenaire (loueur…) : jeton en stockage local, appels authentifiés, hooks de chargement.
export function panelApi(area: string, loginPath: string) {
  const tokenKey = `zedeka-${area}-token`;
  const nameKey = `zedeka-${area}-name`;

  const read = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const store = (key: string, value: string | null) => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      // stockage indisponible (navigation privée) : la session durera le temps de la page
    }
  };

  const getToken = () => read(tokenKey);
  const getName = () => read(nameKey);
  const logout = () => {
    store(tokenKey, null);
    store(nameKey, null);
  };

  async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${API_URL}/api/${area}${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout();
      throw new AuthError(body.error ?? "Connexion requise");
    }
    if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
    return body as T;
  }

  async function login(email: string, password: string) {
    const res = await fetch(`${API_URL}/api/${area}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Connexion impossible");
    store(tokenKey, body.token);
    store(nameKey, body.name);
  }

  function useResource<T>(path: string) {
    const router = useRouter();
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const reload = useCallback(async () => {
      try {
        setData(await apiFetch<T>(path));
        setError(null);
      } catch (e) {
        if (e instanceof AuthError) router.replace(loginPath);
        else setError((e as Error).message);
      }
    }, [path, router]);
    useEffect(() => {
      reload();
    }, [reload]);
    return { data, error, reload };
  }

  function useAction() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const run = useCallback(
      async (fn: () => Promise<unknown>) => {
        try {
          setError(null);
          await fn();
          return true;
        } catch (e) {
          if (e instanceof AuthError) router.replace(loginPath);
          else setError((e as Error).message);
          return false;
        }
      },
      [router],
    );
    return { error, run };
  }

  return { getToken, getName, logout, apiFetch, login, useResource, useAction };
}
