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

import type { OrderStatus } from "@/components/panel/status";
export { STATUS_LABEL } from "@/components/panel/status";
export type AdminOrderStatus = OrderStatus;

export type Vehicle = "MOTO" | "VELO" | "VOITURE";
export const VEHICLE_LABEL: Record<Vehicle, string> = { MOTO: "Moto", VELO: "Vélo", VOITURE: "Voiture" };

export type Employment = "FREELANCE" | "STAFF";
export const EMPLOYMENT_LABEL: Record<Employment, string> = { STAFF: "Salarié Zedeka", FREELANCE: "Indépendant" };

export type Driver = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED";
  online: boolean;
  vehicle: Vehicle;
  employment: Employment;
  monthlySalary: number | null;
  zoneId: string | null;
  zone?: { name: string } | null;
  ordersToday?: number;
  activeOrders?: number;
  lastSeenAt?: string | null;
  lastLatitude?: number | null;
  lastLongitude?: number | null;
  lastLocationAt?: string | null;
};

// Zone technique d'un colis sans position : la répartition lui attribue sa zone.
export const ZONE_TO_ASSIGN = "parcels";

export type AdminZone = {
  id: string;
  name: string;
  pricing: "FIXED" | "DISTANCE";
  deliveryFee: number;
  minFee: number | null;
  perKmFee: number | null;
  maxFee: number | null;
  // Centre de la zone : un colis prend la zone dont le centre est le plus proche de son point de livraison.
  latitude: number | null;
  longitude: number | null;
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
  subscriptionFee: number | null; // abonnement mensuel (FCFA), null pour les anciens restaurants à la commission
  active: boolean;
  zoneId: string | null;
  zone?: { name: string } | null;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  logoUrl: string | null;
  ownerEmail?: string | null;
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
  zoneId: string;
  // Colis : qui paie la livraison (le destinataire paie en espèces à la livraison).
  payer?: "SENDER" | "RECIPIENT";
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
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  locationSource?: "SENDER" | "RECIPIENT" | null;
  // Détail seulement : demande de position envoyée au destinataire d'un colis.
  locationRequest?: { status: "PENDING" | "OPENED" | "SHARED" | "DECLINED" | "EXPIRED" | "REVOKED"; expiresAt: string; accuracyM: number | null; respondedAt: string | null } | null;
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
  preparingAt: string | null;
  readyAt: string | null;
  prepMinutes: number | null;
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

// Étape suivante proposée à l'admin ; à emporter, une commande prête est remise au client.
export function nextStatus(o: Pick<AdminOrder, "status" | "type" | "fulfillment">): AdminOrderStatus | undefined {
  if (o.type === "PARCEL") return ({ PENDING: "CONFIRMED", CONFIRMED: "PICKED_UP", PICKED_UP: "DELIVERED" } as const)[o.status as "PENDING"];
  if (o.fulfillment === "PICKUP" && o.status === "READY") return "DELIVERED";
  return (
    { PENDING: "CONFIRMED", CONFIRMED: "PREPARING", PREPARING: "READY", READY: "PICKED_UP", PICKED_UP: "DELIVERED" } as Partial<
      Record<AdminOrderStatus, AdminOrderStatus>
    >
  )[o.status];
}

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });

// Étapes affichées dans la frise d'une commande, selon son type et son mode de remise.
export function orderSteps(
  o: Pick<AdminOrder, "type" | "fulfillment" | "createdAt" | "confirmedAt" | "preparingAt" | "readyAt" | "pickedUpAt" | "deliveredAt">,
) {
  if (o.type === "PARCEL") {
    return [
      { label: "Nouvelle", at: o.createdAt },
      { label: "Acceptée", at: o.confirmedAt },
      { label: "Ramassé", at: o.pickedUpAt },
      { label: "Livrée", at: o.deliveredAt },
    ];
  }
  const steps = [
    { label: "Nouvelle", at: o.createdAt },
    { label: "Acceptée", at: o.confirmedAt },
    { label: "En préparation", at: o.preparingAt },
    { label: "Prête", at: o.readyAt },
  ];
  if (o.fulfillment === "DELIVERY") steps.push({ label: "En livraison", at: o.pickedUpAt });
  steps.push({ label: o.fulfillment === "PICKUP" ? "Remise" : "Livrée", at: o.deliveredAt });
  return steps;
}
