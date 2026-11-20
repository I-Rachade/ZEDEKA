"use client";

import type { MenuItem } from "./api";
import type { HistoryItem } from "./customer";
import { readStored, useStored, writeStored } from "./device";

// Panier gardé sur l'appareil, pour un seul restaurant à la fois. Les prix sont toujours recalculés par l'API.

// choices : une réponse par groupe de choix du plat (sauce, cuisson…), dans l'ordre des groupes.
export type StoredLine = { key: string; menuItemId: string; variantId?: string; addonIds: string[]; choices?: string[]; quantity: number };
export type StoredCart = { slug: string; name: string; lines: StoredLine[]; at: string };

const CART_KEY = "zedeka.cart";

export const useCart = () => useStored<StoredCart>(CART_KEY);
export const getCart = () => readStored<StoredCart>(CART_KEY);
export const clearCart = () => writeStored(CART_KEY, null);

export function saveCart(slug: string, name: string, lines: StoredLine[]) {
  writeStored(CART_KEY, lines.length ? { slug, name, lines, at: new Date().toISOString() } : null);
}

export const lineKey = (menuItemId: string, variantId: string | undefined, addonIds: string[], choices: string[] = []) =>
  [menuItemId, variantId ?? "", ...[...addonIds].sort(), ...choices.map((c) => `=${c}`)].join("|");

export const cartCount = (cart: StoredCart | null) => cart?.lines.reduce((s, l) => s + l.quantity, 0) ?? 0;

// « Commander à nouveau » : retrouve les plats, variantes et suppléments d'une ancienne commande dans la carte actuelle.
export function reorderLines(items: HistoryItem[], menu: MenuItem[]): { lines: StoredLine[]; missing: string[] } {
  const lines: StoredLine[] = [];
  const missing: string[] = [];
  for (const it of items) {
    const item = menu.find((m) => m.id === it.menuItemId);
    // Le libellé gardé est « Variante · Groupe : réponse · … » (variante absente si le plat n'en a pas).
    const parts = it.variantName ? it.variantName.split(" · ") : [];
    const variantName = item?.variants.length ? parts.shift() : undefined;
    const variant = variantName ? item?.variants.find((v) => v.name === variantName) : undefined;
    const answers = new Map(parts.map((p) => p.split(" : ") as [string, string]));
    const choices = (item?.options ?? []).map((g) => answers.get(g.name));
    const choicesOk = choices.every((c, i) => !!c && item!.options![i].values.includes(c));
    if (!item || item.stock === 0 || (item.variants.length > 0 && !variant) || !choicesOk) {
      missing.push(it.name);
      continue;
    }
    const picked = choices as string[];
    const addonIds = it.addons.map((name) => item.addons.find((a) => a.name === name)?.id).filter((id): id is string => Boolean(id));
    const key = lineKey(item.id, variant?.id, addonIds, picked);
    const existing = lines.find((l) => l.key === key);
    if (existing) existing.quantity += it.quantity;
    else lines.push({ key, menuItemId: item.id, variantId: variant?.id, addonIds, ...(picked.length ? { choices: picked } : {}), quantity: it.quantity });
  }
  return { lines, missing };
}
