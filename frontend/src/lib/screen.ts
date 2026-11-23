// Écran du bureau (/ecran) : lecture seule avec la clé de l'écran, gardée sur l'appareil (Raspberry Pi).
// La clé arrive une fois par le lien créé dans l'admin (/ecran?cle=…), puis disparaît de l'adresse.

const KEY = "zedeka-screen-key";

export function readScreenKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveScreenKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {
    // stockage indisponible : la clé reste dans l'adresse
  }
}

export class ScreenAuthError extends Error {}

export async function screenFetch<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`/api/screen${path}`, { headers: { "x-screen-key": key }, cache: "no-store" });
  if (res.status === 401) throw new ScreenAuthError("Écran non autorisé");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export type Category = "FOOD" | "PARCEL" | "SHOP";

export type ScreenSummary = {
  now: string;
  date: string;
  today: {
    received: number;
    delivered: number;
    inProgress: number;
    cancelled: number;
    byCategory: Record<Category, number>;
    avgMinutes: number | null;
    zedRides: number;
  };
  yesterday: { createdSoFar: number; deliveredSoFar: number };
  goal: { target: number; auto: boolean };
  record: { count: number; date: string } | null;
  last7: number[];
  hourly: number[];
  hourlyYesterday: number[];
  leaderboard: { id: string; name: string; deliveries: number; avgMinutes: number | null }[];
  feed: { code: string; category: Category; from: string | null; zone: string | null; status: string; createdAt: string; deliveredAt: string | null }[];
};

export type ScreenMap = {
  now: string;
  restaurants: { id: string; name: string; kind: "RESTAURANT" | "SHOP"; open: boolean; activeOrders: number; latitude: number; longitude: number }[];
  drivers: { id: string; name: string; vehicle: string; state: "FREE" | "BUSY" | "STALE"; phase: "PICKUP" | "DELIVERY" | null; restaurantId: string | null; latitude: number; longitude: number; fresh: boolean }[];
  counts: {
    driversOnline: number;
    driversFree: number;
    driversBusy: number;
    restaurantsOpen: number;
    shopsOpen: number;
    restaurantsTotal: number;
    ordersInProgress: number;
    toDispatch: number;
    inKitchen: number;
    onTheRoad: number;
    deliveredToday: number;
  };
};

// Paliers fêtés à l'écran : toutes les 10 livraisons (25 quand l'objectif dépasse 100).
export const milestoneStep = (goal: number) => (goal > 100 ? 25 : 10);
// Palier franchi entre deux lectures (le plus haut), ou null.
export function crossedMilestone(before: number, after: number, step: number): number | null {
  if (after <= before) return null;
  const top = Math.floor(after / step) * step;
  return top > before && top > 0 ? top : null;
}
