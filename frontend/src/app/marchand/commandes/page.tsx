"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { card, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";
import { merchantFetch, SALE_STATUS, type ShopSale } from "@/lib/merchant";
import { thumbOf } from "@/lib/media";

// Commandes reçues sur la boutique en ligne : à accepter, à préparer, en livraison ; et les terminées.
export default function ShopOrdersPage() {
  const t = useT();
  const [filter, setFilter] = useState<"open" | "done">("open");
  const [orders, setOrders] = useState<ShopSale[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await merchantFetch<{ orders: ShopSale[] }>(`/shop-orders?filter=${filter}`);
      setOrders(r.orders);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);
  useEffect(() => {
    setOrders(null);
    void load();
  }, [load]);
  useLiveRefresh(() => void load(), { every: 15_000 });

  return (
    <div>
      <TopBar title="Commandes de la boutique" back="/marchand" />
      <div className="space-y-3 px-4 pb-8 pt-3">
        <div className="flex gap-2">
          {(
            [
              ["open", "En cours"],
              ["done", "Terminées"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1.5 text-[14px] font-medium ${filter === key ? "bg-ink text-white" : "bg-stone-100 text-stone-700"}`}
            >
              {t(label)}
            </button>
          ))}
        </div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!orders ? (
          <Skeleton rows={3} />
        ) : orders.length === 0 ? (
          <div className={`${card} card-line p-6 text-center`}>
            <p className="font-semibold">{filter === "open" ? t("Aucune commande en cours") : t("Aucune commande terminée")}</p>
            <p className="mt-1 text-sm text-stone-600">{t("Les commandes des clients arrivent ici, avec une sonnerie sur ce téléphone.")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {orders.map((o) => (
              <li key={o.id}>
                <SaleRow o={o} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SaleRow({ o }: { o: ShopSale }) {
  const t = useT();
  const [label, color] = SALE_STATUS[o.status];
  const count = o.storeItems.reduce((s, i) => s + i.quantity, 0);
  const first = o.storeItems.find((i) => i.imageUrl)?.imageUrl;
  return (
    <Link href={`/marchand/commandes/${o.code}`} className={`${card} card-line flex items-center gap-3 p-3 active:scale-[0.99] ${o.status === "PENDING" ? "ring-2 ring-amber-400" : ""}`}>
      {first ? (
        // eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand
        <img src={thumbOf(first)} alt="" className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />
      ) : (
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[10px] bg-stone-100 text-[24px]">🛍️</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">
            {o.code} · {t("{n} article(s)", { n: count })}
          </span>
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{t(label)}</span>
        </span>
        <span className="block truncate text-[13px] text-stone-600">{o.storeItems.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</span>
        <span className="block text-[13px] font-semibold text-emerald-700">{t("Pour vous : {amount}", { amount: fcfa(o.net) })}</span>
      </span>
    </Link>
  );
}
