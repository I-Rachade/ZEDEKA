"use client";

import { API_URL, type Zone } from "./api";
import { readStored, useStored, writeStored } from "./device";

// Compte client de l'application : connexion par numéro et code à usage unique.

export type Session = { token: string; phone: string; name: string | null };

const SESSION_KEY = "zedeka.customer";

export const useSession = () => useStored<Session>(SESSION_KEY);
export const getSession = () => readStored<Session>(SESSION_KEY);
export const saveSession = (s: Session | null) => writeStored(SESSION_KEY, s);
export const logout = () => saveSession(null);

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
  kind: "FOOD" | "PARCEL" | "RENTAL";
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

export type AppRental = {
  slug: string;
  name: string;
  address: string;
  logoUrl: string | null;
  pickupTimeMin: number;
  pickupTimeMax: number;
  pickupZone: { name: string } | null;
  availability: { open: boolean; reason: string | null };
  vehicleCount: number;
  vehicles: string[];
  priceFrom: number | null;
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
  if (res.status === 401 && session) logout();
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
