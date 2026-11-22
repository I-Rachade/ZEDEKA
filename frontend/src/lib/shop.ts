"use client";

import { useEffect, useState } from "react";
import { apiGet } from "./api";

// Rubrique « Boutiques » côté client : la liste des commerces de type Boutique. Chacun s'ouvre sur sa page /r/…,
// avec le panier et la caisse des restaurants.

export type ShopCategory = { key: string; label: string; emoji: string };
export type ShopCard = {
  slug: string;
  href?: string; // page /r/… du commerce
  name: string;
  area: string;
  category: ShopCategory | null;
  logoUrl: string | null;
  coverUrl: string | null;
  photos: string[];
  productCount: number;
};
export type ShopList = { categories: ShopCategory[]; shops: ShopCard[] };

export const fetchShops = (category?: string | null) => apiGet<ShopList>(`/api/shops${category ? `?category=${encodeURIComponent(category)}` : ""}`);

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
