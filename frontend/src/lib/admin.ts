"use client";

import { currentLang, dateLocale, tr } from "@/lib/i18n";
import { API_URL } from "./api";
import { useStored, writeStored } from "./device";

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
    if (!token) writeStored(STAFF_KEY, null);
  } catch {
    // stockage indisponible (navigation privée) : la session durera le temps de la page
  }
}

// Membre de l'équipe connecté. Le directeur voit tout ; le dispatcheur, les commandes, la répartition et les livreurs.
export type TeamRole = "DIRECTOR" | "DISPATCHER";
export type Staff = { id: string | null; name: string; role: TeamRole };
export const ROLE_LABEL: Record<TeamRole, string> = { DIRECTOR: "Directeur", DISPATCHER: "Dispatcheur" };
const STAFF_KEY = "zedeka.admin.staff";
export const useStaff = () => useStored<Staff>(STAFF_KEY);
export const saveStaff = (s: Staff) => writeStored(STAFF_KEY, s);

export type TeamMember = { id: string; name: string; email: string; role: TeamRole; active: boolean; lastLoginAt: string | null; createdAt: string };

export class AuthError extends Error {}

// Téléchargement authentifié (ex. export CSV).
export async function adminDownload(path: string, filename: string) {
  const res = await fetch(`${API_URL}/api/admin${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (res.status === 401) {
    setToken(null);
    throw new AuthError(tr("Connexion requise"));
  }
  if (!res.ok) throw new Error(tr("Erreur {status}", { status: res.status }));
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
    throw new AuthError(body.error ?? tr("Connexion requise"));
  }
  if (!res.ok) throw new Error(body.error ?? tr("Erreur {status}", { status: res.status }));
  return body as T;
}

// Avec une adresse : compte d'un membre de l'équipe. Sans : mot de passe du directeur des opérations.
export async function login(password: string, email?: string) {
  const res = await fetch(`${API_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email ? { email, password } : { password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? tr("Connexion impossible"));
  setToken(body.token);
  saveStaff({ id: null, name: body.name ?? "Direction", role: body.role ?? "DIRECTOR" });
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
  // Note moyenne des clients (1 à 5) et nombre de notes.
  rating?: number | null;
  ratingCount?: number;
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
  rating?: number | null;
  ratingCount?: number;
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
  // Clôture par le client et notes.
  handedOverAt?: string | null;
  closedBy?: "CUSTOMER" | "CODE" | "AUTO" | "ADMIN" | "DRIVER" | null;
  receiptDisputedAt?: string | null;
  receiptDisputeNote?: string | null;
  driverRating?: number | null;
  restaurantRating?: number | null;
  ratingComment?: string | null;
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

// « t » : traduction de la page qui affiche le titre.
export const orderTitle = (o: Pick<AdminOrder, "type" | "restaurant" | "parcelCategory">, t: (fr: string) => string = (fr) => fr) =>
  o.type === "PARCEL" ? `${t("Colis")}${o.parcelCategory ? ` · ${o.parcelCategory.name}` : ""}` : (o.restaurant?.name ?? t("Repas"));

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

// Affiché après chargement des données, côté navigateur : la langue de la page est connue.
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(dateLocale(currentLang()), { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });

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
