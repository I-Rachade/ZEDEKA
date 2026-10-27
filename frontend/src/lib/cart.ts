"use client";

import type { MenuItem } from "./api";
import type { HistoryItem } from "./customer";
import { readStored, useStored, writeStored } from "./device";

// Panier gardé sur l'appareil, pour un seul restaurant à la fois. Les prix sont toujours recalculés par l'API.

export type StoredLine = { key: string; menuItemId: string; variantId?: string; addonIds: string[]; quantity: number };
export type StoredCart = { slug: string; name: string; lines: StoredLine[]; at: string };

const CART_KEY = "zedeka.cart";

export const useCart = () => useStored<StoredCart>(CART_KEY);
export const getCart = () => readStored<StoredCart>(CART_KEY);
export const clearCart = () => writeStored(CART_KEY, null);

export function saveCart(slug: string, name: string, lines: StoredLine[]) {
  writeStored(CART_KEY, lines.length ? { slug, name, lines, at: new Date().toISOString() } : null);
}

export const lineKey = (menuItemId: string, variantId: string | undefined, addonIds: string[]) =>
  [menuItemId, variantId ?? "", ...[...addonIds].sort()].join("|");

export const cartCount = (cart: StoredCart | null) => cart?.lines.reduce((s, l) => s + l.quantity, 0) ?? 0;

// « Commander à nouveau » : retrouve les plats, variantes et suppléments d'une ancienne commande dans la carte actuelle.
export function reorderLines(items: HistoryItem[], menu: MenuItem[]): { lines: StoredLine[]; missing: string[] } {
  const lines: StoredLine[] = [];
  const missing: string[] = [];
  for (const it of items) {
    const item = menu.find((m) => m.id === it.menuItemId);
    const variant = it.variantName ? item?.variants.find((v) => v.name === it.variantName) : undefined;
    if (!item || (it.variantName && !variant)) {
      missing.push(it.name);
      continue;
    }
    const addonIds = it.addons.map((name) => item.addons.find((a) => a.name === name)?.id).filter((id): id is string => Boolean(id));
    const key = lineKey(item.id, variant?.id, addonIds);
    const existing = lines.find((l) => l.key === key);
    if (existing) existing.quantity += it.quantity;
    else lines.push({ key, menuItemId: item.id, variantId: variant?.id, addonIds, quantity: it.quantity });
  }
  return { lines, missing };
}
