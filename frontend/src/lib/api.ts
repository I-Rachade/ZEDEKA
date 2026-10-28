// Même domaine que le site : /api/* est envoyé à l'API par le Worker du site (worker.ts), ou par `next dev`.
export const API_URL = "";

export type Zone = { id: string; name: string; deliveryFee: number; pricing: "FIXED" | "DISTANCE" };

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
  cancelledAt?: string | null;
  driver?: { firstName: string; vehicle: "MOTO" | "VELO" | "VOITURE" } | null;
  restaurant: { name: string; deliveryTimeMin?: number; deliveryTimeMax?: number } | null;
  zone: { name: string };
  items: OrderLine[];
  refundDue?: number;
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

export type NewParcel = Contact & {
  pickupAddress: string;
  address: string;
  recipientName: string;
  recipientPhone: string;
  parcelCategoryId: string;
  weightKg: number;
  parcelSize?: "SMALL" | "MEDIUM" | "LARGE";
};

export type CreatedOrder = { code: string; total: number; whatsappUrl: string };

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
  if (!res.ok) throw new Error(body.error ?? "L'envoi n'a pas abouti.");
  return body as T;
}

export const createOrder = (order: NewOrder) => apiPost<CreatedOrder>("/api/orders", order);
export const createParcel = (parcel: NewParcel) => apiPost<CreatedOrder>("/api/parcels", parcel);

export function fcfa(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}
