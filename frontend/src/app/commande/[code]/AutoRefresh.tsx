"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { apiGet, type OrderSummary } from "@/lib/api";
import { useLiveRefresh } from "@/lib/live";
import { orderStamp } from "@/lib/orderStamp";

// Suivi en direct tant que la commande est en cours : l'état est relu toutes les 4 s (requête légère), et tout de
// suite quand une notification arrive ou que l'écran revient au premier plan. La page n'est rendue à nouveau que si
// quelque chose a changé (commande acceptée, livreur en route, remise, livrée…). Une fois par minute, elle l'est de
// toute façon, pour l'heure d'arrivée estimée.
export default function AutoRefresh({ code, stamp }: { code: string; stamp: string }) {
  const router = useRouter();
  const known = useRef(stamp);
  const busy = useRef(false);
  const last = useRef(Date.now());

  useEffect(() => {
    known.current = stamp;
    last.current = Date.now();
  }, [stamp]);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const order = await apiGet<OrderSummary>(`/api/orders/${encodeURIComponent(code)}`);
      const next = order ? orderStamp(order) : null;
      if ((next && next !== known.current) || Date.now() - last.current > 60_000) {
        if (next) known.current = next;
        last.current = Date.now();
        router.refresh();
      }
    } catch {
      // réseau coupé : on réessaie au prochain tour
    } finally {
      busy.current = false;
    }
  }, [code, router]);

  useLiveRefresh(check);
  return null;
}
