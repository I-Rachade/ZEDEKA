export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Zone = { id: string; name: string; deliveryFee: number };

export type MenuItem = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;
};

export type Restaurant = {
  slug: string;
  name: string;
  address: string;
  menuItems: MenuItem[];
};

export type OrderStatus = "PENDING" | "CONFIRMED" | "PICKED_UP" | "DELIVERED" | "CANCELLED";

export type OrderSummary = {
  code: string;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  createdAt: string;
  restaurant: { name: string };
  zone: { name: string };
  items: { name: string; unitPrice: number; quantity: number }[];
};

export type NewOrder = {
  restaurantSlug: string;
  zoneId: string;
  customerName: string;
  customerPhone: string;
  address: string;
  note?: string;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  items: { menuItemId: string; quantity: number }[];
};

export type CreatedOrder = { code: string; total: number; whatsappUrl: string };

// Renvoie null si la ressource n'existe pas (404).
export async function apiGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} sur ${path}`);
  return res.json() as Promise<T>;
}

export async function createOrder(order: NewOrder): Promise<CreatedOrder> {
  const res = await fetch(`${API_URL}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "La commande n'a pas pu être envoyée.");
  return body as CreatedOrder;
}

export function fcfa(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}
