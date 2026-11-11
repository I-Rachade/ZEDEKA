"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AlarmQuickAction } from "@/components/panel/partner";
import { fcfa, lineLabel } from "@/lib/api";
import { DEFAULT_PREP_MINUTES, restaurantFetch, type RestaurantOrder } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";
import { ordersChanged } from "./useNewOrders";

// Accepter depuis l'alarme : la plus ancienne commande en attente est montrée dans l'alarme avec
// « Accepter · 15 min ». Un geste au lieu de trois (Voir, ouvrir la liste, Accepter).
// Si plusieurs commandes attendent, l'alarme passe à la suivante après chaque acceptation.
export function useAlarmAccept(pending: number | undefined): AlarmQuickAction | null {
  const t = useT();
  const router = useRouter();
  const [order, setOrder] = useState<RestaurantOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    restaurantFetch<RestaurantOrder[]>("/orders?active=1")
      .then((list) => {
        const oldest = list.filter((o) => o.status === "PENDING").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        setOrder(oldest ?? null);
      })
      .catch(() => setOrder(null));
  }, []);

  useEffect(() => {
    if (pending) load();
    else setOrder(null);
  }, [pending, load]);

  if (!order) return null;
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await restaurantFetch(`/orders/${order.id}/status`, { method: "POST", body: { status: "PREPARING", prepMinutes: DEFAULT_PREP_MINUTES } });
      setOrder(null);
      ordersChanged();
    } catch (e) {
      setError((e as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  };
  const mode =
    order.tableNumber != null
      ? t("Table {number} · sur place", { number: order.tableNumber })
      : order.fulfillment === "PICKUP"
        ? t("À emporter")
        : t("Livraison");
  return {
    label: t("Accepter · {n} min", { n: DEFAULT_PREP_MINUTES }),
    busy,
    error,
    onRun: accept,
    onView: () => router.push(`/restaurant/commandes/${order.id}`),
    preview: (
      <>
        <p className="flex items-baseline justify-between gap-2 font-bold">
          <span>{order.code}</span>
          <span>{fcfa(order.subtotal)}</span>
        </p>
        <p className="mt-1 text-sm text-[#d3eede]">{mode}</p>
        <ul className="mt-2 space-y-1 text-[15px]">
          {order.items.slice(0, 4).map((i) => (
            <li key={i.id}>
              {i.quantity}× {lineLabel(i)}
            </li>
          ))}
          {order.items.length > 4 && <li className="text-sm text-[#d3eede]">{t("+ {n} autres", { n: order.items.length - 4 })}</li>}
        </ul>
        {order.note && <p className="mt-2 text-sm text-[#d3eede]">{t("Note du client :")} {order.note}</p>}
      </>
    ),
  };
}
