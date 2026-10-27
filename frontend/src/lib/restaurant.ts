"use client";

import { API_URL } from "./api";
import { AuthError, type AdminMenuItem, type AdminOption, type AdminOrder } from "./admin";

export { AuthError };

const TOKEN_KEY = "zedeka-restaurant-token";
const NAME_KEY = "zedeka-restaurant-name";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // stockage indisponible (navigation privée) : la session durera le temps de la page
  }
}

export const getRestaurantToken = () => read(TOKEN_KEY);
export const getRestaurantName = () => read(NAME_KEY);

export function saveRestaurantSession(token: string, name?: string) {
  store(TOKEN_KEY, token);
  if (name) store(NAME_KEY, name);
}

export function logout() {
  store(TOKEN_KEY, null);
  store(NAME_KEY, null);
}

export async function restaurantFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api/restaurant${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getRestaurantToken() ?? ""}` },
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

export async function restaurantLogin(email: string, password: string) {
  const res = await fetch(`${API_URL}/api/restaurant/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Connexion impossible");
  store(TOKEN_KEY, body.token);
  store(NAME_KEY, body.name);
}

export type OpeningSlot = { day: number; open: string; close: string };

export type Me = {
  id: string;
  slug: string;
  name: string;
  phone: string;
  address: string;
  logoUrl: string | null;
  commissionRate: number;
  subscriptionFee: number | null;
  temporarilyClosed: boolean;
  closedUntil: string | null;
  ownerEmail: string | null;
  openingHours: OpeningSlot[];
  minOrderAmount: number;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  zone: { name: string } | null;
  availability: { open: boolean; reason: string | null };
};

// Le restaurant ne reçoit pas la rémunération du livreur.
export type OrderEdit = { id: string; reason: string; changes: { name: string; from: number; to: number; replacement?: string }[]; oldTotal: number; newTotal: number; refund: number; createdAt: string };

export type RestaurantOrder = Omit<AdminOrder, "driverEarning" | "items"> & {
  items: (AdminOrder["items"][number] & { id: string; menuItemId: string })[];
  edits: OrderEdit[];
  refundDue: number;
};
export type Menu = { menuItems: AdminMenuItem[]; addons: AdminOption[] };

export type Settlement = {
  id: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  orderTotal: number;
  commission: number;
  amountDue: number;
  paidAt: string | null;
  createdAt: string;
};

export const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
