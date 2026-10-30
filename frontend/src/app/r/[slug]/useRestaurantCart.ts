"use client";

import { useMemo } from "react";
import { lineLabel, type MenuItem, type Restaurant } from "@/lib/api";
import { lineKey, saveCart, useCart } from "@/lib/cart";
import { tr } from "@/lib/i18n";

// Panier du restaurant affiché, gardé sur l'appareil (un seul restaurant à la fois).

export type CartLine = { key: string; item: MenuItem; variantId?: string; addonIds: string[]; quantity: number };

export function unitPrice(item: MenuItem, variantId: string | undefined, addonIds: string[]) {
  const base = item.variants.find((v) => v.id === variantId)?.price ?? item.price;
  return base + item.addons.filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
}

export function describe(line: CartLine) {
  return lineLabel({
    name: line.item.name,
    variantName: line.item.variants.find((v) => v.id === line.variantId)?.name ?? null,
    addons: line.item.addons.filter((a) => line.addonIds.includes(a.id)),
  });
}

export const fromPrice = (item: MenuItem) => (item.variants.length ? Math.min(...item.variants.map((v) => v.price)) : item.price);

export function useRestaurantCart(restaurant: Restaurant) {
  const stored = useCart();
  const lines = useMemo<CartLine[]>(() => {
    if (stored?.slug !== restaurant.slug) return [];
    return stored.lines.flatMap((l) => {
      const item = restaurant.menuItems.find((m) => m.id === l.menuItemId);
      return item ? [{ key: l.key, item, variantId: l.variantId, addonIds: l.addonIds, quantity: l.quantity }] : [];
    });
  }, [stored, restaurant]);
  const otherCart = stored && stored.slug !== restaurant.slug && stored.lines.length > 0 ? stored : null;

  const save = (next: CartLine[]) => saveCart(restaurant.slug, restaurant.name, next.map(({ item, ...l }) => ({ ...l, menuItemId: item.id })));

  // Renvoie false si le client refuse de vider le panier d'un autre restaurant.
  function add(item: MenuItem, variantId: string | undefined, addonIds: string[], quantity = 1): boolean {
    if (otherCart && !window.confirm(tr("Votre panier contient des plats de {name}. Le vider pour commander ici ?", { name: otherCart.name }))) return false;
    const key = lineKey(item.id, variantId, addonIds);
    const existing = lines.find((l) => l.key === key);
    save(existing ? lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + quantity } : l)) : [...lines, { key, item, variantId, addonIds, quantity }]);
    return true;
  }

  const change = (key: string, delta: number) => save(lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0));
  const remove = (key: string) => save(lines.filter((l) => l.key !== key));

  const subtotal = lines.reduce((s, l) => s + unitPrice(l.item, l.variantId, l.addonIds) * l.quantity, 0);
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const countFor = (id: string) => lines.filter((l) => l.item.id === id).reduce((s, l) => s + l.quantity, 0);

  return { lines, otherCart, add, change, remove, subtotal, count, countFor };
}
