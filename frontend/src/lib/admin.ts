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

// Téléchargement authentifié (ex. export CSV).
export async function adminDownload(path: string, filename: string) {
  const res = await fetch(`${API_URL}/api/admin${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (res.status === 401) {
    setToken(null);
    throw new AuthError("Connexion requise");
  }
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

export type Vehicle = "MOTO" | "VELO" | "VOITURE";
export const VEHICLE_LABEL: Record<Vehicle, string> = { MOTO: "Moto", VELO: "Vélo", VOITURE: "Voiture" };

export type Driver = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED";
  online: boolean;
  vehicle: Vehicle;
  zoneId: string | null;
  zone?: { name: string } | null;
  ordersToday?: number;
  activeOrders?: number;
};

export type AdminZone = {
  id: string;
  name: string;
  pricing: "FIXED" | "DISTANCE";
  deliveryFee: number;
  minFee: number | null;
  perKmFee: number | null;
  maxFee: number | null;
  active: boolean;
};

export type AdminOption = { id: string; name: string; price: number; available?: boolean };

export type AdminMenuItem = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  available: boolean;
  sortOrder: number;
  variants: AdminOption[];
  addons: { id: string }[];
};

export type AdminRestaurant = {
  id: string;
  slug: string;
  name: string;
  phone: string;
  address: string;
  commissionRate: number;
  active: boolean;
  zoneId: string | null;
  zone?: { name: string } | null;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  _count?: { orders: number; menuItems: number };
  menuItems?: AdminMenuItem[];
  addons?: AdminOption[];
};

export type AdminOrder = {
  id: string;
  code: string;
  type: "FOOD" | "PARCEL";
  fulfillment: "DELIVERY" | "PICKUP";
  status: AdminOrderStatus;
  customerName: string;
  customerPhone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  note: string | null;
  pickupAddress: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  weightKg: number | null;
  parcelCategory: { name: string } | null;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  paymentStatus: "UNPAID" | "PAID";
  subtotal: number;
  discount: number;
  deliveryFee: number;
  extraFee: number;
  total: number;
  commission: number;
  driverEarning: number;
  cancellationFee: number;
  cancellationReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  restaurant: { name: string; phone: string; address?: string } | null;
  zone: { name: string };
  driver: { id: string; name: string; phone: string } | null;
  items: { name: string; variantName: string | null; addons: { name: string; price: number }[]; quantity: number; unitPrice: number }[];
};

export const orderTitle = (o: Pick<AdminOrder, "type" | "restaurant" | "parcelCategory">) =>
  o.type === "PARCEL" ? `Colis${o.parcelCategory ? ` · ${o.parcelCategory.name}` : ""}` : (o.restaurant?.name ?? "Repas");

export const NEXT_STATUS: Partial<Record<AdminOrderStatus, AdminOrderStatus>> = {
  PENDING: "CONFIRMED",
  CONFIRMED: "PICKED_UP",
  PICKED_UP: "DELIVERED",
};

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
