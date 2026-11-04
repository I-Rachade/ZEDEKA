"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ACTIVE_PROMO_KEY, fetchPromos, type HomePromo } from "@/lib/api";
import { readStored, writeStored } from "@/lib/device";
import { useT } from "@/lib/i18n/client";

// Rangée « Offres pour vous » de l'accueil : les codes que l'admin met en avant. « Activer » garde le code sur le
// téléphone, et la caisse le reprend tout seul.
export default function Offers() {
  const t = useT();
  const [offers, setOffers] = useState<HomePromo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    fetchPromos().then((p) => setOffers(p ?? []), () => {});
    setActive(readStored<string>(ACTIVE_PROMO_KEY));
  }, []);
  if (offers.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="px-4 text-[20px] font-bold leading-tight">{t("Offres pour vous")}</h2>
      <div className="flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-noswipe>
        {offers.map((o) => {
          const on = active === o.code;
          const big = o.kind === "PERCENT" ? `-${o.value} %` : o.kind === "FREE_DELIVERY" ? t("OFFERTE") : `-${o.value.toLocaleString("fr-FR")} F`;
          const eyebrow = o.restaurant ? o.restaurant.name : o.kind === "FREE_DELIVERY" ? t("Livraison") : t("Toute la commande");
          return (
            <div
              key={o.code}
              className={`sheen relative w-[248px] shrink-0 snap-start overflow-hidden rounded-[22px] p-4 text-white ${o.kind === "FREE_DELIVERY" ? "deep-green" : "deep-ink"}`}
            >
              <p className="text-[12px] font-semibold uppercase tracking-wide text-white/70">{eyebrow}</p>
              <p className="font-display mt-0.5 text-[40px] font-extrabold leading-none">{big}</p>
              <p className="mt-1 line-clamp-1 text-[13px] text-white/80">{o.title || o.label}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="rounded-md border border-dashed border-white/50 px-2 py-0.5 font-mono text-[12px] font-semibold">{o.code}</span>
                {o.restaurant && !on ? (
                  <Link
                    href={`/r/${o.restaurant.slug}`}
                    onClick={() => {
                      writeStored(ACTIVE_PROMO_KEY, o.code);
                      setActive(o.code);
                    }}
                    className="rounded-full bg-sun px-3.5 py-1.5 text-[13px] font-bold text-ink"
                  >
                    {t("Activer")}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      writeStored(ACTIVE_PROMO_KEY, on ? null : o.code);
                      setActive(on ? null : o.code);
                    }}
                    aria-pressed={on}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${on ? "bg-white/20 text-white" : "bg-sun text-ink"}`}
                  >
                    {on ? `✓ ${t("Activé")}` : t("Activer")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
