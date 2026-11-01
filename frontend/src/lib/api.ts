import { tr } from "@/lib/i18n";

// Même domaine que le site : /api/* est envoyé à l'API par le Worker du site (worker.ts), ou par `next dev`.
export const API_URL = "";

export type Zone = { id: string; name: string; deliveryFee: number; pricing: "FIXED" | "DISTANCE"; minFee?: number | null; perKmFee?: number | null; maxFee?: number | null };

export type Option = { id: string; name: string; price: number };

export type MenuItem = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  variants: Option[];
  addons: Option[];
};

export type Restaurant = {
  slug: string;
  name: string;
  address: string;
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  zone: { id: string; name: string } | null;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  minOrderAmount: number;
  availability: { open: boolean; reason: string | null };
  menuItems: MenuItem[];
};

export type ParcelCategory = { id: string; name: string; surcharge: number; perKgFee: number };

export type OrderLine = {
  name: string;
  variantName: string | null;
  addons: { name: string; price: number }[];
  unitPrice: number;
  quantity: number;
};

export function lineLabel(l: Pick<OrderLine, "name" | "variantName" | "addons">): string {
  const extras = [l.variantName, ...(l.addons ?? []).map((a) => `+ ${a.name}`)].filter(Boolean);
  return extras.length ? `${l.name} (${extras.join(", ")})` : l.name;
}

export type OrderStatus = "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "PICKED_UP" | "DELIVERED" | "CANCELLED";

export type OrderSummary = {
  code: string;
  type: "FOOD" | "PARCEL";
  fulfillment: "DELIVERY" | "PICKUP";
  status: OrderStatus;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  extraFee: number;
  total: number;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  createdAt: string;
  confirmedAt?: string | null;
  preparingAt?: string | null;
  prepMinutes?: number | null;
  readyAt?: string | null;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  // Remise déclarée par le livreur : en attente de la confirmation du client.
  handedOverAt?: string | null;
  cancelledAt?: string | null;
  driver?: { firstName: string; vehicle: "MOTO" | "VELO" | "VOITURE" } | null;
  restaurant: { name: string; deliveryTimeMin?: number; deliveryTimeMax?: number } | null;
  zone: { name: string };
  items: OrderLine[];
  refundDue?: number;
  // Colis : demande de position au destinataire (null si l'expéditeur a écrit l'adresse).
  locationStatus?: LocationStatus | null;
  // Colis : en attente de la position du destinataire, le prix de livraison n'est pas encore fixé.
  awaitingPosition?: boolean;
  edits?: { reason: string; changes: { name: string; from: number; to: number; replacement?: string }[]; oldTotal: number; newTotal: number; refund: number; createdAt: string }[];
};

type Contact = {
  zoneId: string;
  customerName: string;
  customerPhone: string;
  note?: string;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  latitude?: number;
  longitude?: number;
};

export type NewOrder = Contact & {
  restaurantSlug: string;
  fulfillment: "DELIVERY" | "PICKUP";
  address: string;
  items: { menuItemId: string; quantity: number; variantId?: string; addonIds?: string[] }[];
};

export type NewParcel = Omit<Contact, "zoneId"> & {
  pickupAddress: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  address: string;
  askRecipientLocation?: boolean;
  // Demande de position faite depuis le formulaire : clé de suivi de la réponse.
  locationRequestKey?: string;
  // Qui paie la livraison : l'expéditeur, ou le destinataire en espèces à la réception.
  payer?: "SENDER" | "RECIPIENT";
  recipientName: string;
  recipientPhone: string;
  parcelCategoryId: string;
  weightKg: number;
  parcelSize?: "SMALL" | "MEDIUM" | "LARGE";
};

export type LocationStatus = "PENDING" | "SHARED" | "DECLINED" | "EXPIRED";
// Lien à envoyer au destinataire d'un colis pour qu'il partage sa position.
export type LocationLink = { url: string; text?: string; expiresAt: string };
// Demande faite depuis le formulaire, avant la commande : la clé sert à suivre la réponse.
export type LocationRequest = LocationLink & { pollKey: string };
export type LocationAnswer = { status: "PENDING" | "OPENED" | "SHARED" | "DECLINED"; latitude?: number; longitude?: number; accuracy?: number | null; landmark?: string | null };
// Tarif des colis (réglages) : même calcul que l'API.
export type ParcelPricing = { minFee: number; perKmFee: number; maxFee: number | null };

export type CreatedOrder = { code: string; total: number; whatsappUrl: string; locationLink?: LocationLink | null; awaitingPosition?: boolean; priceToConfirm?: boolean };

// Renvoie null si la ressource n'existe pas (404).
export async function apiGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} sur ${path}`);
  return res.json() as Promise<T>;
}

// Jeton du client connecté dans l'application, pour rattacher la commande à son compte.
function customerAuth(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const token = (JSON.parse(window.localStorage.getItem("zedeka.customer") ?? "null") as { token?: string } | null)?.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...customerAuth() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? tr("L'envoi n'a pas abouti."));
  return body as T;
}

// Clôture de la livraison par le client : état, code à donner au livreur, confirmation et notes.
export type Receipt = {
  state: "CONFIRM" | "DISPUTED" | "RATE" | null;
  allowed: boolean;
  handedOverAt: string | null;
  deliveryCode: string | null;
  driverFirstName: string | null;
  restaurantName: string | null;
  driverRating: number | null;
  restaurantRating: number | null;
};
export type ReceiptAnswer = { received: true; driverRating: number; restaurantRating?: number; comment?: string } | { received: false; note: string };

export async function readReceipt(code: string): Promise<Receipt | null> {
  const res = await fetch(`${API_URL}/api/orders/${encodeURIComponent(code)}/receipt`, { cache: "no-store", headers: customerAuth() });
  return res.ok ? (res.json() as Promise<Receipt>) : null;
}
export const answerReceipt = (code: string, answer: ReceiptAnswer) => apiPost<{ ok: true }>(`/api/orders/${encodeURIComponent(code)}/receipt`, answer);

export const createOrder = (order: NewOrder) => apiPost<CreatedOrder>("/api/orders", order);
export const createParcel = (parcel: NewParcel) => apiPost<CreatedOrder>("/api/parcels", parcel);
// Nouveau lien de position depuis le suivi : compte de l'expéditeur, ou son numéro.
export const requestLocationLink = (code: string, phone?: string) => apiPost<LocationLink>(`/api/parcels/${encodeURIComponent(code)}/location-link`, { phone });
export const createLocationRequest = (senderName: string, recipientName?: string) => apiPost<LocationRequest>("/api/location-requests", { senderName, recipientName });
export const readLocationAnswer = (pollKey: string) => apiGet<LocationAnswer>(`/api/location-requests/${encodeURIComponent(pollKey)}`);
export const locateZone = (p: { latitude: number; longitude: number }) => apiGet<{ zoneId: string | null }>(`/api/zones/locate?latitude=${p.latitude}&longitude=${p.longitude}`);

export function parcelFee(t: ParcelPricing, km: number | null): number {
  if (km === null || !t.perKmFee) return t.minFee;
  return Math.min(Math.max(Math.ceil((km * t.perKmFee) / 50) * 50, t.minFee), t.maxFee ?? Infinity);
}

// Lien Google Maps (même court) ou coordonnées collés : position du point.
export const resolveMapsLink = (url: string) => apiPost<{ latitude: number; longitude: number }>("/api/maps-link", { url });
// L'expéditeur place lui-même le point de livraison depuis le suivi : le prix est alors fixé.
export const setDeliveryPoint = (code: string, point: { latitude: number; longitude: number }, phone?: string) =>
  apiPost<{ deliveryFee: number; total: number; distanceKm: number | null }>(`/api/parcels/${encodeURIComponent(code)}/delivery-point`, { ...point, phone });

export function fcfa(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}
