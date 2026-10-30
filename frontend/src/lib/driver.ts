"use client";

import { currentLang, dateLocale, tr } from "@/lib/i18n";
import { API_URL } from "./api";
import { readStored, useStored, writeStored } from "./device";

// Application livreur : session, appels à l'API, file des étapes validées sans réseau.

export type DriverSession = { token: string; name: string; phone: string };
export type Application = { name: string; status: "PENDING" | "REJECTED" | "SUSPENDED"; createdAt: string };

const SESSION_KEY = "zedeka.driver";
const QUEUE_KEY = "zedeka.driver.queue";
export const APPLICATION_KEY = "zedeka.driver.application";

export const useDriverSession = () => useStored<DriverSession>(SESSION_KEY);
export const getDriverSession = () => readStored<DriverSession>(SESSION_KEY);
export const saveDriverSession = (s: DriverSession | null) => writeStored(SESSION_KEY, s);
export const driverLogout = () => {
  saveDriverSession(null);
  writeStored(QUEUE_KEY, null);
};

export type DriverOrder = {
  id: string;
  code: string;
  type: "FOOD" | "PARCEL";
  status: "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "PICKED_UP" | "DELIVERED" | "CANCELLED";
  customerName: string;
  customerPhone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  // Colis : point de livraison donné par le destinataire (lien) ou l'expéditeur, et position du retrait.
  locationSource: "SENDER" | "RECIPIENT" | null;
  locationRequest: { status: string; accuracyM: number | null } | null;
  note: string | null;
  pickupAddress: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  recipientName: string | null;
  recipientPhone: string | null;
  weightKg: number | null;
  parcelSize: "SMALL" | "MEDIUM" | "LARGE" | null;
  parcelCategory: { name: string } | null;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  // Colis : RECIPIENT si le destinataire paie, en espèces à la livraison.
  payer?: "SENDER" | "RECIPIENT";
  paymentStatus: "PAID" | "UNPAID";
  total: number;
  deliveryFee: number;
  extraFee: number;
  driverEarning: number;
  cashCollected: number | null;
  cashNote: string | null;
  cashDue: number;
  prepMinutes: number | null;
  createdAt: string;
  confirmedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  zone: { name: string };
  restaurant: { name: string; phone: string; address: string; latitude: number | null; longitude: number | null } | null;
  items: { name: string; variantName: string | null; quantity: number }[];
};

export type Offer = { id: string; expiresAt: string; order: DriverOrder };
export type Current = { online: boolean; serverTime: string; offers: Offer[]; active: DriverOrder[] };

export type DriverProfile = {
  name: string;
  phone: string;
  vehicle: "MOTO" | "VELO" | "VOITURE";
  employment: "FREELANCE" | "STAFF";
  monthlySalary: number | null;
  online: boolean;
  createdAt: string;
  zone: { name: string } | null;
  delivered: number;
  dispatchPhone: string;
};

export class NetworkError extends Error {}

async function request<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/livreur${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new NetworkError(tr("Pas de réseau"));
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && init.token) driverLogout();
  if (!res.ok) throw Object.assign(new Error(data.error ?? tr("La demande n'a pas abouti")), data, { status: res.status });
  return data as T;
}

export const driverPublic = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body });

export function driverFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return request<T>(path, { ...init, token: getDriverSession()?.token });
}

// --- Étapes validées hors connexion : gardées sur le téléphone et renvoyées dans l'ordre au retour du réseau ---

export type QueuedStep = { orderId: string; status: "PICKED_UP" | "DELIVERED"; at: string; cashCollected?: number; cashNote?: string };

export const useQueue = () => useStored<QueuedStep[]>(QUEUE_KEY) ?? [];
const readQueue = () => readStored<QueuedStep[]>(QUEUE_KEY) ?? [];

// Envoie l'étape ; sans réseau elle part dans la file. Renvoie la commande à jour, ou null si mise en file.
export async function sendStep(step: QueuedStep): Promise<DriverOrder | null> {
  if (readQueue().some((q) => q.orderId === step.orderId)) {
    writeStored(QUEUE_KEY, [...readQueue(), step]);
    return null;
  }
  try {
    return await driverFetch<DriverOrder>(`/orders/${step.orderId}/status`, { method: "POST", body: step });
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    writeStored(QUEUE_KEY, [...readQueue(), step]);
    return null;
  }
}

let flushing = false;
// Renvoie la file ; une étape refusée par le serveur est retirée et son message renvoyé.
export async function flushQueue(): Promise<string[]> {
  if (flushing) return [];
  flushing = true;
  const errors: string[] = [];
  try {
    for (;;) {
      const [next, ...rest] = readQueue();
      if (!next) break;
      try {
        await driverFetch(`/orders/${next.orderId}/status`, { method: "POST", body: next });
      } catch (e) {
        if (e instanceof NetworkError) break;
        errors.push((e as Error).message);
      }
      writeStored(QUEUE_KEY, rest);
    }
  } finally {
    flushing = false;
  }
  return errors;
}

// Statut affiché : celui du serveur, avancé par les étapes encore en file.
export function shownStatus(order: DriverOrder, queue: QueuedStep[]): DriverOrder["status"] {
  const mine = queue.filter((q) => q.orderId === order.id);
  if (mine.some((q) => q.status === "DELIVERED")) return "DELIVERED";
  if (mine.some((q) => q.status === "PICKED_UP")) return "PICKED_UP";
  return order.status;
}

export const ISSUE_KINDS = [
  { value: "RESTAURANT_CLOSED", label: "Restaurant fermé ou commande pas prête" },
  { value: "CUSTOMER_UNREACHABLE", label: "Client injoignable" },
  { value: "ADDRESS_NOT_FOUND", label: "Adresse introuvable" },
  { value: "ACCIDENT", label: "Accident ou panne" },
  { value: "PAYMENT", label: "Problème de paiement" },
  { value: "OTHER", label: "Autre" },
] as const;

export const REJECT_REASONS = ["Trop loin", "Déjà en course", "Panne ou plus de carburant", "Fin de service"];

export const mapsUrl = (lat: number | null, lng: number | null, address: string) =>
  lat !== null && lng !== null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Lomé`)}`;

export const tel = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, "")}`;

export const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(dateLocale(currentLang()), { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" }) : null);
