"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { thumbOf } from "@/lib/media";
import type { ShopCard } from "@/lib/shop";

// Carte d'une boutique : bannière (ou les premières photos de produits), logo, nom, catégorie et quartier.
export default function ShopRow({ s, compact = false }: { s: ShopCard; compact?: boolean }) {
  const t = useT();
  return (
    <Link href={s.href ?? `/app/boutiques/${s.slug}`} className={`card-gloss block overflow-hidden rounded-[16px] bg-surface transition active:scale-[0.98] ${compact ? "w-[260px] shrink-0 snap-start" : ""}`}>
      <span className="flex h-[112px] w-full overflow-hidden bg-stone-100">
        {s.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- bannière envoyée par le marchand
          <img src={thumbOf(s.coverUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : s.photos.length > 0 ? (
          s.photos.slice(0, 3).map((u) => (
            // eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand
            <img key={u} src={thumbOf(u)} alt="" loading="lazy" className="h-full min-w-0 flex-1 object-cover" />
          ))
        ) : (
          <span className="grid w-full place-items-center text-[40px]">{s.category?.emoji ?? "🛍️"}</span>
        )}
      </span>
      <span className="flex items-center gap-3 p-3">
        {s.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo envoyé par le marchand
          <img src={s.logoUrl} alt="" className="keep-round h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
        ) : (
          <span className="keep-round grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-[22px]">{s.category?.emoji ?? "🛍️"}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[16px] font-bold">{s.name}</span>
            <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">✓ {t("Vérifiée")}</span>
          </span>
          <span className="block truncate text-[13px] text-stone-500">
            {s.category ? t(s.category.label) : t("Boutique")} · {s.area}
          </span>
          <span className="block text-[12px] text-stone-500">{t("{n} produits", { n: s.productCount })}</span>
        </span>
      </span>
    </Link>
  );
}
