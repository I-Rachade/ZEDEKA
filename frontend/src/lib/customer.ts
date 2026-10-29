"use client";

import { API_URL, type Zone } from "./api";
import { readStored, useStored, writeStored } from "./device";

// Compte client de l'application : connexion par numéro et code à usage unique.

export type Session = { token: string; phone: string; name: string | null };

const SESSION_KEY = "zedeka.customer";

export const useSession = () => useStored<Session>(SESSION_KEY);
export const getSession = () => readStored<Session>(SESSION_KEY);
export const saveSession = (s: Session | null) => writeStored(SESSION_KEY, s);
// Déconnexion volontaire : le téléphone est souvent partagé, on efface aussi les données personnelles gardées
// sur l'appareil (contact et adresse de la caisse, adresse choisie, position, commandes récentes).
export const logout = () => {
  saveSession(null);
  for (const key of ["zedeka.guest", "zedeka.place", "zedeka.position", "zedeka.recent"]) writeStored(key, null);
};

export type Address = {
  id: string;
  label: string;
  quarter: string;
  landmark: string;
  latitude: number | null;
  longitude: number | null;
  zone: { id: string; name: string };
};

export type Profile = { phone: string; name: string | null; createdAt: string; addresses: Address[] };

export type HistoryItem = { menuItemId: string; name: string; variantName: string | null; addons: string[]; quantity: number };

export type HistoryEntry = {
  kind: "FOOD" | "PARCEL";
  code: string;
  status: string;
  total: number;
  createdAt: string;
  ongoing: boolean;
  title: string;
  subtitle: string;
  logoUrl: string | null;
  restaurantSlug?: string | null;
  items?: HistoryItem[];
  scheduledAt?: string | null;
};

export type AppRestaurant = {
  slug: string;
  name: string;
  address: string;
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  minOrderAmount: number;
  categories: string[];
  availability: { open: boolean; reason: string | null };
  sameZone: boolean;
  deliveryFee: number | null;
  feeFrom: boolean;
  dishes: { id: string; name: string; price: number; imageUrl: string | null }[];
};

// Appel de l'API du compte client ; une session expirée ou supprimée déconnecte l'appareil.
export async function customerFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = getSession();
  const res = await fetch(`${API_URL}/api/customer${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && session) saveSession(null);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? "La demande n'a pas abouti."), { status: res.status, retryIn: body.retryIn });
  return body as T;
}

export const requestCode = (phone: string) =>
  customerFetch<{ phone: string; expiresInMinutes: number; devCode?: string }>("/otp/request", { method: "POST", body: { phone } });

export async function verifyCode(phone: string, code: string) {
  const r = await customerFetch<{ token: string; customer: { phone: string; name: string | null } }>("/otp/verify", { method: "POST", body: { phone, code } });
  saveSession({ token: r.token, ...r.customer });
  return r;
}

// Adresse choisie sur l'appareil (accueil, panier) : une adresse enregistrée, ou seulement une zone.
export type Place = { addressId?: string; zoneId: string; label: string };

const PLACE_KEY = "zedeka.place";
export const usePlace = () => useStored<Place>(PLACE_KEY);
export const getPlace = () => readStored<Place>(PLACE_KEY);
export const savePlace = (p: Place | null) => writeStored(PLACE_KEY, p);

// Dernière position connue du client (GPS ou adresse enregistrée), pour afficher les distances.
export type Position = { latitude: number; longitude: number };
const POSITION_KEY = "zedeka.position";
export const usePosition = () => useStored<Position>(POSITION_KEY);
export const rememberPosition = (p: Position | null) => p && writeStored(POSITION_KEY, { latitude: p.latitude, longitude: p.longitude });

export function locateMe(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { latitude: p.coords.latitude, longitude: p.coords.longitude };
        rememberPosition(pos);
        resolve(pos);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}

// Distance à vol d'oiseau en km (comme l'API), arrondie à 0,1 km.
export function distanceKm(a: Position, b: { latitude: number | null; longitude: number | null }): number | null {
  if (b.latitude === null || b.longitude === null) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export const km = (d: number) => `${d.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;

export const addressLine = (a: Pick<Address, "label" | "quarter" | "landmark">) => `${a.quarter}, ${a.landmark} (${a.label})`;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Même règle que l'API : la zone dont le nom cite le quartier saisi.
export function guessZone(zones: Zone[], quarter: string): Zone | null {
  const words = fold(quarter).split(" ").filter(Boolean);
  if (!words.length) return null;
  return (
    zones.find((zone) => {
      const listed = fold(zone.name.match(/\(([^)]*)\)/)?.[1] ?? zone.name.split(/[–-]/).slice(1).join(" "))
        .split(" ")
        .filter((w) => w.length >= 2);
      return listed.some((w) => words.includes(w));
    }) ?? null
  );
}
