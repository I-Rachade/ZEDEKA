"use client";

import Link from "next/link";
import { Icon } from "@/components/panel/icons";
import { useT } from "@/lib/i18n/client";
import { moduleOn, useServices } from "@/lib/services";
import { useShops } from "@/lib/shop";
import ShopRow from "./ShopRow";

// Accueil : rangée « Boutiques près de vous », une fois la rubrique ouverte dans la page Services de l'admin.
export default function ShopsNearby() {
  const services = useServices();
  const on = moduleOn(services, "SHOP");
  return on ? <Row /> : null;
}

function Row() {
  const t = useT();
  const shops = useShops();
  const list = shops.data?.shops ?? [];
  if (!list.length) return null;
  return (
    <section className="space-y-3" aria-labelledby="shops-title">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 id="shops-title" className="text-[20px] font-bold leading-tight">
          {t("Boutiques près de vous")}
        </h2>
        <Link href="/app/boutiques" aria-label={t("Toutes les boutiques")} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-100 text-ink">
          <Icon name="arrow" className="h-4.5 w-4.5" />
        </Link>
      </div>
      <div className="flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-noswipe>
        {list.slice(0, 10).map((s) => (
          <ShopRow key={s.slug} s={s} compact />
        ))}
      </div>
    </section>
  );
}
