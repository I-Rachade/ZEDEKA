"use client";

import { useEffect } from "react";

// Recharge une vue quand le cadre détecte une nouvelle commande.
export function useOnNewOrder(fn: () => void) {
  useEffect(() => {
    window.addEventListener("zedeka:new-order", fn);
    return () => window.removeEventListener("zedeka:new-order", fn);
  }, [fn]);
}

// Prévient le cadre (compteurs du menu) qu'une commande a changé de statut.
export const ordersChanged = () => window.dispatchEvent(new Event("zedeka:orders-changed"));
