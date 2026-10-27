"use client";

import { API_URL } from "./api";

const TOKEN_KEY = "zedeka-admin-token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // stockage indisponible (navigation privée) : la session durera le temps de la page
  }
}

export class AuthError extends Error {}

export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api/admin${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken(null);
    throw new AuthError(body.error ?? "Connexion requise");
  }
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body as T;
}

export async function login(password: string) {
  const res = await fetch(`${API_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Connexion impossible");
  setToken(body.token);
}

export type AdminOrderStatus = "PENDING" | "CONFIRMED" | "PICKED_UP" | "DELIVERED" | "CANCELLED";

export const STATUS_LABEL: Record<AdminOrderStatus, string> = {
  PENDING: "Reçue",
  CONFIRMED: "Confirmée",
  PICKED_UP: "En livraison",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

export const STATUS_COLOR: Record<AdminOrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-sky-100 text-sky-800",
  PICKED_UP: "bg-violet-100 text-violet-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-stone-200 text-stone-600",
};

export type Driver = { id: string; name: string; phone: string; active: boolean; ordersToday?: number };
export type AdminZone = { id: string; name: string; deliveryFee: number; active: boolean };
export type AdminMenuItem = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;
  available: boolean;
  sortOrder: number;
};
export type AdminRestaurant = {
  id: string;
  slug: string;
  name: string;
  phone: string;
  address: string;
  commissionRate: number;
  active: boolean;
  _count?: { orders: number; menuItems: number };
  menuItems?: AdminMenuItem[];
};
