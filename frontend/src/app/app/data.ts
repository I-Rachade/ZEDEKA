"use client";

import { useEffect, useState } from "react";
import { apiGet, type OrderSummary, type Zone } from "@/lib/api";
import { customerFetch, usePosition, useSession, type AppRestaurant, type HistoryEntry } from "@/lib/customer";
import { RECENT_KEY, useStored, type RecentOrder } from "@/lib/device";
import { tr } from "@/lib/i18n";
import { useLiveRefresh } from "@/lib/live";

// Chargements de l'application client.

// reload : rechargement visible (squelette) ; refresh : relecture discrète, l'écran garde ses données en attendant.
type Loadable<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void; refresh: () => void };

// Dernière réponse gardée sur l'appareil (accueil, zones, publicités) : à la réouverture de l'application, l'écran
// s'affiche aussitôt avec elle, puis la réponse fraîche de l'API la remplace dès qu'elle arrive.
const SNAPSHOT_PREFIX = "zedeka-snapshot:";
type Snapshot<T> = { k: string; d: T };

function readSnapshot<T>(name: string, k: string): T | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_PREFIX + name);
    const snap = raw ? (JSON.parse(raw) as Snapshot<T>) : null;
    return snap && snap.k === k ? snap.d : null;
  } catch {
    return null;
  }
}

function writeSnapshot<T>(name: string, k: string, d: T) {
  try {
    window.localStorage.setItem(SNAPSHOT_PREFIX + name, JSON.stringify({ k, d } satisfies Snapshot<T>));
  } catch {
    // stockage plein ou indisponible : l'écran attendra simplement l'API la prochaine fois
  }
}

// snapshot : nom de la copie gardée et paramètres qu'elle doit partager avec l'écran (par défaut, toutes les dépendances).
function useLoad<T>(load: (() => Promise<T>) | null, deps: unknown[], snapshot?: { name: string; match?: unknown[] }): Loadable<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; key: string | null }>({ data: null, error: null, key: null });
  const [tick, setTick] = useState(0);
  const [quiet, setQuiet] = useState(0);
  const snapKey = JSON.stringify(snapshot?.match ?? deps);
  const key = JSON.stringify([...deps, tick]);
  useEffect(() => {
    if (!load) return;
    let live = true;
    // Premier affichage (ou paramètres changés) : la copie gardée pour ces mêmes paramètres, sans squelette.
    if (snapshot && tick === 0) {
      const kept = readSnapshot<T>(snapshot.name, snapKey);
      if (kept !== null) setState((s) => (s.key === key && s.data ? s : { data: kept, error: null, key }));
    }
    load().then(
      (data) => {
        if (!live) return;
        setState({ data, error: null, key });
        if (snapshot) writeSnapshot(snapshot.name, snapKey, data);
      },
      // Échec d'une relecture discrète : on garde ce qui est affiché.
      (e: Error) => live && setState((s) => (s.key === key && s.data ? s : { data: null, error: e.message || tr("Chargement impossible"), key })),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rechargé quand les dépendances (sérialisées) changent
  }, [key, quiet, Boolean(load)]);
  return {
    data: state.data,
    error: state.error,
    loading: Boolean(load) && state.key !== key,
    reload: () => setTick((t) => t + 1),
    refresh: () => setQuiet((q) => q + 1),
  };
}

let zonesCache: Promise<Zone[]> | null = null;

export function useZones() {
  return useLoad(() => (zonesCache ??= apiGet<Zone[]>("/api/zones").then((z) => z ?? [])), [], { name: "zones" });
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
  return useLoad(() => apiGet<AppRestaurant[]>(`/api/restaurants?${params}`).then((r) => r ?? []), [zoneId, q, params.get("latitude"), params.get("longitude")], 
    // Accueil : la liste gardée sert tant que la zone est la même ; les frais exacts arrivent avec la réponse fraîche.
    q ? undefined : { name: "restaurants", match: [zoneId ?? null] },
  );
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
  // Commandes en cours : leur état se met à jour tout seul (toutes les 8 s, et dès qu'une notification arrive).
  useLiveRefresh(result.refresh, { every: 8000, enabled: Boolean(result.data?.some((h) => h.ongoing)) });
  return { ...result, account: Boolean(session) };
}

// Publicités de l'accueil (carrousel sous « Livrer à »), gérées dans l'admin.
export type HomeAd = { id: string; title: string; imageUrl: string; linkUrl: string | null };
let adsCache: Promise<HomeAd[]> | null = null;
export function useAds() {
  return useLoad(() => (adsCache ??= apiGet<HomeAd[]>("/api/ads").then((a) => a ?? []).catch(() => ((adsCache = null), []))), [], { name: "ads" });
}
