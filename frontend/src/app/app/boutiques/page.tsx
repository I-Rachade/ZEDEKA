"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { shopCartCount, useShopCart, useShops } from "@/lib/shop";
import { Empty, Skeleton, TopBar } from "../ui";
import ShopRow from "./ShopRow";

// Rubrique « Boutiques » : les boutiques vérifiées par Zedeka, par catégorie (Mode, Beauté, Téléphones…).
export default function ShopsPage() {
  const t = useT();
  const [category, setCategory] = useState<string | null>(null);
  const shops = useShops(category);
  const cart = useShopCart();
  const categories = shops.data?.categories ?? [];

  return (
    <div className="pb-28">
      <TopBar title="Boutiques" back="/app" />
      <div className="space-y-4 pt-3">
        <div className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" data-noswipe>
          {[{ key: null, label: "Tout", emoji: "🛍️" }, ...categories].map((c) => (
            <button
              key={c.key ?? "all"}
              type="button"
              aria-pressed={category === c.key}
              onClick={() => setCategory(c.key)}
              className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[14px] font-semibold ${category === c.key ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-stone-200 text-ink"}`}
            >
              <span aria-hidden="true">{c.emoji}</span>
              {t(c.label)}
            </button>
          ))}
        </div>

        <div className="space-y-3 px-4">
          {shops.loading ? (
            <Skeleton />
          ) : !shops.data ? (
            <Empty icon="store" title="Les boutiques arrivent bientôt sur Zedeka" />
          ) : shops.data.shops.length === 0 ? (
            <Empty icon="store" title="Aucune boutique dans cette catégorie pour l'instant" />
          ) : (
            shops.data.shops.map((s) => <ShopRow key={s.slug} s={s} />)
          )}
        </div>
      </div>

      {cart && cart.lines.length > 0 && (
        <Link
          href={`/app/boutiques/${cart.slug}/panier`}
          className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between rounded-2xl bg-emerald-700 px-4 py-3.5 text-white shadow-lg"
        >
          <span className="font-semibold">{t("Panier · {name}", { name: cart.name })}</span>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[14px] font-bold">{shopCartCount(cart)}</span>
        </Link>
      )}
    </div>
  );
}
