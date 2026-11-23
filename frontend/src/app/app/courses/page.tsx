"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { moduleOn, useServices } from "@/lib/services";
import { useShops } from "@/lib/shop";
import { Empty, Skeleton, TopBar } from "../ui";
import ShopRow from "../boutiques/ShopRow";

// Courses du quotidien : supermarchés, pharmacies, gaz et eau, épiceries parmi les boutiques vérifiées, et deux
// raccourcis quand ils sont ouverts dans la page Services de l'admin : « Courses pour moi » (un livreur achète votre
// liste) et « Gaz et eau » (recharge de bouteille ou bidons livrés).
const TILES = [
  { key: "supermarche", label: "Supermarché", emoji: "🛒" },
  { key: "pharmacie", label: "Pharmacie", emoji: "💊" },
  { key: "gaz-eau", label: "Gaz et eau", emoji: "🔥" },
  { key: "epicerie", label: "Épicerie et boissons", emoji: "🥫" },
] as const;

export default function DailyShoppingPage() {
  const t = useT();
  const services = useServices();
  const [category, setCategory] = useState<string | null>(null);
  const shopsOpen = moduleOn(services, "SHOP");
  const shops = useShops(category, category ? undefined : "quotidien");
  const errand = moduleOn(services, "ERRAND");
  const gas = moduleOn(services, "GAS");

  return (
    <div className="pb-28">
      <TopBar title="Courses du quotidien" back="/app" />
      <div className="space-y-4 pt-3">
        <div className="grid grid-cols-2 gap-2.5 px-4" role="group" aria-label={t("Catégories")}>
          {TILES.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={category === c.key}
              onClick={() => setCategory(category === c.key ? null : c.key)}
              className={`card-gloss flex items-center gap-2.5 rounded-[16px] px-3 py-3 text-left transition active:scale-[0.98] ${category === c.key ? "ring-2 ring-emerald-700" : ""}`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[22px]" aria-hidden="true">
                {c.emoji}
              </span>
              <span className="text-[15px] font-bold leading-tight">{t(c.label)}</span>
            </button>
          ))}
        </div>

        {category === "pharmacie" && (
          <p className="mx-4 rounded-xl bg-sky-50 px-3 py-2.5 text-[13px] text-sky-900">
            {t("Médicaments sur ordonnance : gardez l'ordonnance, le livreur la demande à la remise.")}
          </p>
        )}

        {(errand || gas) && (
          <div className="space-y-2 px-4">
            {errand && (
              <Shortcut href="/app/services/ERRAND" emoji="📝" title={t("Courses pour moi")} hint={t("Envoyez votre liste, un livreur achète et vous l'apporte.")} />
            )}
            {gas && <Shortcut href="/app/services/GAS" emoji="🔥" title={t("Gaz et eau")} hint={t("Bouteille de gaz ou bidons d'eau livrés chez vous.")} />}
          </div>
        )}

        <div className="space-y-3 px-4">
          {!shopsOpen ? (
            <Empty icon="store" title="Les boutiques arrivent bientôt sur Zedeka" />
          ) : shops.loading ? (
            <Skeleton />
          ) : !shops.data || shops.data.shops.length === 0 ? (
            <Empty icon="store" title="Aucune boutique dans cette catégorie pour l'instant" />
          ) : (
            shops.data.shops.map((s) => <ShopRow key={s.slug} s={s} />)
          )}
        </div>
      </div>
    </div>
  );
}

function Shortcut({ href, emoji, title, hint }: { href: string; emoji: string; title: string; hint: string }) {
  return (
    <Link href={href} className="card-gloss flex items-center gap-3 rounded-[16px] px-3 py-3 transition active:scale-[0.98]">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sun-soft text-[22px]" aria-hidden="true">
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">{title}</span>
        <span className="block text-[13px] text-stone-500">{hint}</span>
      </span>
    </Link>
  );
}
