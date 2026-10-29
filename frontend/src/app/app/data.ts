"use client";

import { useEffect, useState } from "react";
import { apiGet, type OrderSummary, type Zone } from "@/lib/api";
import { customerFetch, usePosition, useSession, type AppRestaurant, type HistoryEntry } from "@/lib/customer";
import { RECENT_KEY, useStored, type RecentOrder } from "@/lib/device";
import { tr } from "@/lib/i18n";

// Chargements de l'application client.

type Loadable<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

function useLoad<T>(load: (() => Promise<T>) | null, deps: unknown[]): Loadable<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; key: string | null }>({ data: null, error: null, key: null });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([...deps, tick]);
  useEffect(() => {
    if (!load) return;
    let live = true;
    load().then(
      (data) => live && setState({ data, error: null, key }),
      (e: Error) => live && setState({ data: null, error: e.message || tr("Chargement impossible"), key }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rechargé quand les dépendances (sérialisées) changent
  }, [key, Boolean(load)]);
  return { data: state.data, error: state.error, loading: Boolean(load) && state.key !== key, reload: () => setTick((t) => t + 1) };
}

let zonesCache: Promise<Zone[]> | null = null;

export function useZones() {
  return useLoad(() => (zonesCache ??= apiGet<Zone[]>("/api/zones").then((z) => z ?? [])), []);
}

// Frais de livraison au km depuis la dernière position connue du client, sinon prix de sa zone.
export function useRestaurants(zoneId: string | undefined, q = "") {
  const position = usePosition();
  const params = new URLSearchParams();
  if (zoneId) params.set("zoneId", zoneId);
  if (q) params.set("q", q);
  if (position) {
    params.set("latitude", position.latitude.toFixed(5));
    params.set("longitude", position.longitude.toFixed(5));
  }
  return useLoad(() => apiGet<AppRestaurant[]>(`/api/restaurants?${params}`).then((r) => r ?? []), [zoneId, q, params.get("latitude"), params.get("longitude")]);
}

const ORDER_DONE = ["DELIVERED", "CANCELLED"];

// Commandes passées depuis cet appareil sans compte : relues une par une via le suivi public.
async function recentHistory(recent: RecentOrder[]): Promise<HistoryEntry[]> {
  const entries = await Promise.all(
    recent.map(async (r): Promise<HistoryEntry | null> => {
      const o = await apiGet<OrderSummary>(`/api/orders/${r.code}`).catch(() => null);
      return (
        o && {
          kind: o.type,
          code: o.code,
          status: o.status,
          total: o.total,
          createdAt: o.createdAt,
          ongoing: !ORDER_DONE.includes(o.status),
          title: o.type === "FOOD" ? (o.restaurant?.name ?? "Repas") : "Colis",
          subtitle: o.type === "FOOD" ? o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ") : o.zone.name,
          logoUrl: null,
        }
      );
    }),
  );
  return entries.filter((e): e is HistoryEntry => e !== null);
}

// Historique : celui du compte si le client est connecté, sinon les commandes gardées sur l'appareil.
export function useHistory() {
  const session = useSession();
  const recent = useStored<RecentOrder[]>(RECENT_KEY);
  const result = useLoad(
    () => (session ? customerFetch<HistoryEntry[]>("/orders") : recentHistory(recent ?? [])),
    [session?.token ?? null, session ? null : (recent ?? []).map((r) => r.code).join(",")],
  );
  return { ...result, account: Boolean(session) };
}
