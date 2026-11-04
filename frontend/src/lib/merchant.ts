"use client";

import { tr } from "@/lib/i18n";
import { API_URL } from "./api";
import { getSession, saveSession } from "./customer";

// Appli marchand (/marchand) : boutiques e-commerce qui envoient leurs colis. Même compte que l'appli client
// (numéro ou e-mail et PIN), avec en plus un profil boutique.

export type Merchant = {
  id: string;
  shopName: string;
  phone: string;
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  pickupDays: number[];
  pickupTime: string | null;
  payoutPhone: string | null;
  active: boolean;
  pickupRequestedAt: string | null;
  createdAt: string;
};

export type Me = { account: { name: string | null; phone: string; email: string | null }; merchant: Merchant | null };

export type ParcelStatus = "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "PICKED_UP" | "DELIVERED" | "CANCELLED";

export type MerchantParcel = {
  id: string;
  code: string;
  status: ParcelStatus;
  recipientName: string | null;
  recipientPhone: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  codAmount: number;
  merchantRef: string | null;
  payer: "SENDER" | "RECIPIENT";
  deliveryFee: number;
  extraFee: number;
  discount: number;
  total: number;
  fees: number;
  net: number;
  paidOut: boolean;
  cashCollected: number | null;
  weightKg: number | null;
  parcelSize: string | null;
  note: string | null;
  category: string | null;
  createdAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  driver: { name: string; phone: string } | null;
  zone: { name: string } | null;
};

export type RecipientMessage = { text: string; whatsappUrl: string; trackUrl: string };

export type ParcelDetail = MerchantParcel & {
  handedOverAt: string | null;
  disputed: boolean;
  deliveryCode: string | null;
  locationStatus: string | null;
  message: RecipientMessage;
};

export type Dashboard = {
  today: number;
  open: number;
  waitingPickup: number;
  balance: number;
  balanceCount: number;
  month: { sent: number; delivered: number; cancelled: number; cod: number };
  payouts: Payout[];
};

export type Payout = { id: string; amount: number; orderCount: number; note: string | null; createdAt: string };

// Un colis de l'envoi, tel que saisi.
export type ParcelLine = {
  recipientName: string;
  recipientPhone: string;
  address: string;
  latitude?: number;
  longitude?: number;
  askRecipientLocation: boolean;
  codAmount: number;
  payer: "SENDER" | "RECIPIENT";
  merchantRef?: string;
  parcelCategoryId: string;
  weightKg: number;
  parcelSize?: "SMALL" | "MEDIUM" | "LARGE";
  note?: string;
};

export type Quote = {
  lines: { fee: number; km: number | null; zone: string | null; toConfirm: boolean; waiting: boolean; toCollect: number }[];
  fees: number;
  cod: number;
};

export type Sent = {
  parcels: { code: string; recipientName: string; total: number; fees: number; awaitingPosition: boolean; message: RecipientMessage }[];
  fees: number;
};

export class NeedsLogin extends Error {}

export async function merchantFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = getSession();
  if (!session) throw new NeedsLogin(tr("Connexion requise"));
  const res = await fetch(`${API_URL}/api/marchand${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.token}`,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    saveSession(null);
    throw new NeedsLogin(body.error ?? tr("Connexion requise"));
  }
  if (!res.ok) throw Object.assign(new Error(body.error ?? tr("La demande n'a pas abouti.")), { status: res.status });
  return body as T;
}

export const LOGIN_HREF = "/marchand/connexion?suite=/marchand";

export const PARCEL_STATUS: Record<ParcelStatus, [string, string]> = {
  PENDING: ["À ramasser", "bg-amber-100 text-amber-800"],
  CONFIRMED: ["Livreur en route", "bg-sky-100 text-sky-800"],
  PREPARING: ["Livreur en route", "bg-sky-100 text-sky-800"],
  READY: ["Livreur en route", "bg-sky-100 text-sky-800"],
  PICKED_UP: ["En livraison", "bg-violet-100 text-violet-800"],
  DELIVERED: ["Livré", "bg-emerald-100 text-emerald-800"],
  CANCELLED: ["Annulé", "bg-stone-200 text-stone-600"],
};

export const WEEK_DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

// Liste collée depuis un tableur ou WhatsApp : une ligne par colis, « Nom ; Téléphone ; Adresse ; Montant ; Réf ».
// Séparateurs acceptés : point-virgule, tabulation ou virgule. Les lignes sans nom ni numéro valable sont ignorées.
export function parsePastedList(text: string): { recipientName: string; recipientPhone: string; address: string; codAmount: number; merchantRef: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",").map((c) => c.trim()))
    .map(([name = "", phone = "", address = "", amount = "", ref = ""]) => ({
      recipientName: name,
      recipientPhone: phone,
      address,
      codAmount: Number(amount.replace(/[^\d]/g, "")) || 0,
      merchantRef: ref,
    }))
    .filter((l) => l.recipientName.length >= 2 && l.recipientPhone.replace(/\D/g, "").length >= 8);
}
