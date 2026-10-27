"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Recharge la page de suivi toutes les 20 s tant que la commande est en cours (et que l'onglet est visible).
export default function AutoRefresh({ every = 20_000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, every);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}
