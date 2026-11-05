"use client";

import { clearCache } from "./panelCache";
import { tr } from "@/lib/i18n";
import { API_URL } from "./api";
import { AuthError, type AdminMenuItem, type AdminOption, type AdminOrder } from "./admin";

export { AuthError };

const TOKEN_KEY = "zedeka-restaurant-token";
const NAME_KEY = "zedeka-restaurant-name";
const ROLE_KEY = "zedeka-restaurant-role";

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
// Rôle retenu à la connexion (affichage immédiat du menu) ; /me fait foi.
export const getRestaurantRole = (): RestaurantRole => {
  const r = read(ROLE_KEY);
  return r === "MANAGER" || r === "CASHIER" ? r : "OWNER";
};

export function saveRestaurantSession(token: string, name?: string) {
  store(TOKEN_KEY, token);
  if (name) store(NAME_KEY, name);
}

export function logout() {
  clearCache("restaurant");
  store(TOKEN_KEY, null);
  store(NAME_KEY, null);
  store(ROLE_KEY, null);
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
    throw new AuthError(body.error ?? tr("Connexion requise"));
  }
  if (!res.ok) throw new Error(body.error ?? tr("Erreur {status}", { status: res.status }));
  return body as T;
}

// Photo d'un plat envoyée depuis l'appareil (déjà réduite par MenuEditor) ; renvoie son lien.
export async function restaurantUploadImage(path: string, photo: Blob): Promise<string> {
  const res = await fetch(`${API_URL}/api/restaurant${path}`, {
    method: "POST",
    headers: { "Content-Type": photo.type, Authorization: `Bearer ${getRestaurantToken() ?? ""}` },
    body: photo,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout();
    throw new AuthError(body.error ?? tr("Connexion requise"));
  }
  if (!res.ok) throw new Error(body.error ?? tr("Erreur {status}", { status: res.status }));
  return body.url as string;
}

export async function restaurantLogin(email: string, password: string) {
  const res = await fetch(`${API_URL}/api/restaurant/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? tr("Connexion impossible"));
  store(TOKEN_KEY, body.token);
  store(NAME_KEY, body.name);
  store(ROLE_KEY, body.role ?? "OWNER");
}

// Gérant (compte créé par Zedeka), manageuse ou caissière (équipe créée par le gérant).
export type RestaurantRole = "OWNER" | "MANAGER" | "CASHIER";
export const ROLE_LABEL: Record<RestaurantRole, string> = { OWNER: "Gérant", MANAGER: "Manageuse", CASHIER: "Caissière" };

export type TeamMember = { id: string; name: string; email: string; role: "MANAGER" | "CASHIER"; active: boolean; lastLoginAt: string | null; createdAt: string };

export type OpeningSlot = { day: number; open: string; close: string };

export type Me = {
  id: string;
  slug: string;
  name: string;
  phone: string;
  address: string;
  logoUrl: string | null;
  commissionRate?: number; // absent pour la caissière
  subscriptionFee?: number | null;
  temporarilyClosed: boolean;
  closedUntil: string | null;
  ownerEmail?: string | null;
  account: { role: RestaurantRole; name: string; email: string | null };
  openingHours: OpeningSlot[];
  minOrderAmount: number;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  zone: { name: string } | null;
  availability: { open: boolean; reason: string | null };
};

// Le restaurant ne reçoit pas la rémunération du livreur.
export type OrderEdit = { id: string; reason: string; changes: { name: string; from: number; to: number; replacement?: string }[]; oldTotal: number; newTotal: number; refund: number; createdAt: string };

// Livreur vu par le restaurant : minutes avant d'arriver (dernière position) ou déjà au restaurant.
export type PanelDriver = { id: string; name: string; phone: string; plate: string | null; atRestaurant: boolean; etaMin: number | null; rating?: number | null };
export type RestaurantOrder = Omit<AdminOrder, "driverEarning" | "items" | "driver"> & {
  driver: PanelDriver | null;
  items: (AdminOrder["items"][number] & { id: string; menuItemId: string })[];
  edits: OrderEdit[];
  refundDue: number;
  counterPaidBy: string | null;
  counterPaidAt: string | null;
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
