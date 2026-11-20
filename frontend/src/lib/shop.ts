"use client";

import { useEffect, useState } from "react";
import type { CarouselBanner } from "@/components/StoreCarousel";
import type { StoreViewProduct } from "@/components/StoreView";
import { apiGet, apiPost } from "./api";
import { readStored, useStored, writeStored } from "./device";

// Boutiques en ligne côté client : liste, page d'une boutique, panier (une seule boutique à la fois, gardé sur
// l'appareil) et commande. Le serveur revérifie prix, stock et choix à la commande.

export type ShopCategory = { key: string; label: string; emoji: string };
export type ShopCard = {
  slug: string;
  href?: string; // commerce de type Boutique : sa page /r/…, avec le panier et la caisse des restaurants
  name: string;
  area: string;
  category: ShopCategory | null;
  logoUrl: string | null;
  coverUrl: string | null;
  photos: string[];
  productCount: number;
};
export type ShopList = { categories: ShopCategory[]; shops: ShopCard[] };
export type ShopPage = {
  slug: string;
  name: string;
  area: string;
  category: ShopCategory | null;
  description: string | null;
  logoUrl: string | null;
  verified: boolean;
  mobileMoney: boolean;
  products: StoreViewProduct[];
  banners: CarouselBanner[];
};

export type ShopCartLine = { key: string; productId: string; name: string; price: number; imageUrl: string | null; choice: Record<string, string>; quantity: number };
export type ShopCart = { slug: string; name: string; lines: ShopCartLine[]; at: string };

const CART_KEY = "zedeka.shopCart";
export const useShopCart = () => useStored<ShopCart>(CART_KEY);
export const getShopCart = () => readStored<ShopCart>(CART_KEY);
export const clearShopCart = () => writeStored(CART_KEY, null);

export const choiceKey = (productId: string, choice: Record<string, string>) =>
  `${productId}|${Object.keys(choice)
    .sort()
    .map((k) => `${k}=${choice[k]}`)
    .join("&")}`;
export const choiceLabel = (choice: Record<string, string>) =>
  Object.entries(choice)
    .map(([k, v]) => `${k} : ${v}`)
    .join(" · ");
export const shopCartCount = (cart: ShopCart | null) => cart?.lines.reduce((s, l) => s + l.quantity, 0) ?? 0;
export const shopCartTotal = (cart: ShopCart | null) => cart?.lines.reduce((s, l) => s + l.price * l.quantity, 0) ?? 0;

// Ajoute un article. Un panier d'une autre boutique est remplacé (confirmé avant par l'écran).
export function addToShopCart(shop: { slug: string; name: string }, p: StoreViewProduct, choice: Record<string, string>, quantity = 1) {
  const current = getShopCart();
  const base = current && current.slug === shop.slug ? current : { slug: shop.slug, name: shop.name, lines: [], at: "" };
  const key = choiceKey(p.id, choice);
  const existing = base.lines.find((l) => l.key === key);
  const inCart = base.lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.quantity, 0);
  const add = Math.max(0, Math.min(quantity, p.stock - inCart));
  if (!add) return false;
  const lines = existing
    ? base.lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + add } : l))
    : [...base.lines, { key, productId: p.id, name: p.name, price: p.price, imageUrl: p.imageUrls[0] ?? null, choice, quantity: add }];
  writeStored(CART_KEY, { ...base, lines, at: new Date().toISOString() });
  return true;
}

export function setShopLine(key: string, quantity: number) {
  const cart = getShopCart();
  if (!cart) return;
  const lines = quantity <= 0 ? cart.lines.filter((l) => l.key !== key) : cart.lines.map((l) => (l.key === key ? { ...l, quantity } : l));
  writeStored(CART_KEY, lines.length ? { ...cart, lines } : null);
}

// Commande refusée parce que les prix ont changé : le panier prend les nouveaux prix, le client les voit.
export function repriceShopCart(prices: Record<string, number>) {
  const cart = getShopCart();
  if (!cart) return;
  writeStored(CART_KEY, { ...cart, lines: cart.lines.map((l) => (prices[l.productId] !== undefined ? { ...l, price: prices[l.productId] } : l)) });
}

export const fetchShops = (category?: string | null) => apiGet<ShopList>(`/api/shops${category ? `?category=${encodeURIComponent(category)}` : ""}`);
export const fetchShop = (slug: string) => apiGet<ShopPage>(`/api/shops/${encodeURIComponent(slug)}`);
export const quoteShop = (slug: string, point: { latitude: number; longitude: number }) =>
  apiPost<{ deliveryFee: number; km: number | null; zone: string | null }>(`/api/shops/${encodeURIComponent(slug)}/quote`, point);

export type NewShopOrder = {
  items: { productId: string; quantity: number; choice: Record<string, string> }[];
  latitude: number;
  longitude: number;
  address: string;
  customerName: string;
  customerPhone: string;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  note?: string;
  acceptTerms: true;
  // Total des articles affiché : le serveur refuse la commande si les prix ont changé.
  expectedSubtotal: number;
};
export const orderFromShop = (slug: string, order: NewShopOrder) => apiPost<{ code: string; total: number }>(`/api/shops/${encodeURIComponent(slug)}/orders`, order);

// Liste des boutiques ; null tant que la rubrique n'est pas ouverte (réponse 404).
export function useShops(category?: string | null) {
  const [state, setState] = useState<{ data: ShopList | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fetchShops(category)
      .then((data) => live && setState({ data, loading: false, error: null }))
      .catch((e: Error) => live && setState({ data: null, loading: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [category]);
  return state;
}
