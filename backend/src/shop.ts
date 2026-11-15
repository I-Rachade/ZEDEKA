import { z } from "zod";
import { phone } from "./util.js";
import { readJson, type ProductOption } from "./store.js";

// Boutiques en ligne, étape 2 : la vente aux clients. Une commande de boutique est un colis du marchand vers
// le client (type PARCEL, storeSale), payé en espèces à la livraison ou en mobile money comme un repas.
// Le marchand l'accepte, prépare le paquet et le déclare prêt : seulement alors la répartition l'envoie à un
// livreur. Zedeka garde sa part (commission, ou rien si la boutique paie un abonnement) et reverse le reste
// au marchand par la page « Argent », comme le contre-remboursement des colis.

export const MAX_LINES = 30;
export const MAX_QUANTITY = 20;
// Sans réponse du marchand, la commande est annulée et le client prévenu.
export const ACCEPT_WITHIN_MS = 30 * 60_000;
export const SHOP_REFUSED = "Refusée par la boutique";
export const SHOP_TIMEOUT = "La boutique n'a pas répondu à temps";

const point = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) };

export const cartItemInput = z.object({
  productId: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  // Choix du client pour chaque option du produit : { Taille: "M", Couleur: "Bleu" }.
  choice: z.record(z.string().max(40), z.string().max(40)).default({}),
});
export type CartItem = z.infer<typeof cartItemInput>;

export const cartInput = z.object({ items: z.array(cartItemInput).min(1, "Votre panier est vide").max(MAX_LINES) });

export const quoteInput = z.object(point);

export const shopOrderInput = cartInput.extend({
  ...point,
  address: z.string().trim().max(300).default(""),
  customerName: z.string().trim().min(2, "Indiquez votre nom").max(80),
  customerPhone: phone,
  paymentMethod: z.enum(["CASH", "MOBILE_MONEY"]),
  note: z.string().trim().max(300).optional(),
});

type ProductForCart = { id: string; name: string; price: number; stock: number; options: string; imageUrls: string; visible: boolean; review: string; archivedAt: Date | null };
export type CartLine = { productId: string; name: string; choice: string; imageUrl: string | null; unitPrice: number; quantity: number };

export class CartError extends Error {}

// Lignes du panier au prix et au stock du moment. Chaque option du produit doit être choisie parmi ses valeurs.
// Un même produit avec le même choix est regroupé ; le stock vaut pour toutes ses lignes ensemble.
export function priceCart(items: CartItem[], products: ProductForCart[]): { lines: CartLine[]; subtotal: number } {
  const merged = new Map<string, CartLine>();
  const wanted = new Map<string, number>();
  for (const item of items) {
    const p = products.find((x) => x.id === item.productId);
    if (!p || p.archivedAt || !p.visible || p.review !== "APPROVED") throw new CartError("Un article de votre panier n'est plus en vente : retirez-le pour continuer");
    const options = readJson<ProductOption[]>(p.options, []);
    const parts: string[] = [];
    for (const o of options) {
      const v = item.choice[o.name];
      if (!v || !o.values.includes(v)) throw new CartError(`${p.name} : choisissez ${o.name.toLowerCase()}`);
      parts.push(`${o.name} : ${v}`);
    }
    const choice = parts.join(" · ");
    const total = (wanted.get(p.id) ?? 0) + item.quantity;
    if (p.stock <= 0) throw new CartError(`${p.name} est épuisé`);
    if (total > p.stock) throw new CartError(`${p.name} : plus que ${p.stock} en stock`);
    wanted.set(p.id, total);
    const key = `${p.id}|${choice}`;
    const line = merged.get(key);
    if (line) line.quantity += item.quantity;
    else merged.set(key, { productId: p.id, name: p.name, choice, imageUrl: readJson<string[]>(p.imageUrls, [])[0] ?? null, unitPrice: p.price, quantity: item.quantity });
  }
  const lines = [...merged.values()];
  return { lines, subtotal: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) };
}

// Quantité commandée par produit, pour retirer puis remettre le stock.
export function quantities(lines: { productId: string | null; quantity: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) if (l.productId) out.set(l.productId, (out.get(l.productId) ?? 0) + l.quantity);
  return out;
}

// Part de Zedeka sur une vente : le taux de la boutique (0 % avec un abonnement).
export const shopCommission = (subtotal: number, rate: number) => Math.round((subtotal * rate) / 100);

// Ce que le marchand peut faire sur une vente : accepter, déclarer le paquet prêt, refuser tant qu'il n'est pas parti.
export type ShopAction = "accept" | "ready" | "refuse";
export function shopMove(status: string, action: ShopAction): "CONFIRMED" | "READY" | "CANCELLED" | null {
  if (action === "accept") return status === "PENDING" ? "CONFIRMED" : null;
  if (action === "ready") return status === "CONFIRMED" || status === "PREPARING" ? "READY" : null;
  return status === "PENDING" || status === "CONFIRMED" || status === "PREPARING" ? "CANCELLED" : null;
}
