"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { distanceKm, locateMe, usePlace, usePosition } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { useRestaurants } from "../data";
import { CUISINES } from "../cuisines";
import { Empty, RestaurantCard, Skeleton } from "../ui";

type Sort = "default" | "near" | "fast" | "top";

// Recherche : champ, tuiles de catégories (comme l'accueil), pastilles de filtres et de tri, liste avec photos.
export default function FoodHome() {
  const place = usePlace();
  const position = usePosition();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("default");
  const [locating, setLocating] = useState(false);
  const t = useT();
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useRestaurants(place?.zoneId, q.length >= 2 ? q : "");

  // Tuiles : seulement les catégories qui ont au moins un restaurant dans les résultats.
  const categories = useMemo(() => CUISINES.filter((c) => (results.data ?? []).some((r) => r.cuisines?.includes(c.key))), [results.data]);

  const list = useMemo(() => {
    const rows = (results.data ?? []).filter(
      (r) => (!category || (r.cuisines ?? []).includes(category)) && (!openOnly || r.availability.open) && (!freeOnly || r.deliveryFee === 0),
    );
    if (sort === "top") return [...rows].sort((a, b) => (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0));
    if (sort === "fast") return [...rows].sort((a, b) => a.deliveryTimeMax - b.deliveryTimeMax);
    if (sort === "near" && position) return [...rows].sort((a, b) => (distanceKm(position, a) ?? 1e9) - (distanceKm(position, b) ?? 1e9));
    return rows;
  }, [results.data, category, openOnly, freeOnly, sort, position]);

  async function near() {
    if (!position) {
      setLocating(true);
      await locateMe();
      setLocating(false);
    }
    setSort("near");
  }

  const chip = (on: boolean) => `shrink-0 rounded-full px-3.5 py-1.5 text-[14px] font-medium ${on ? "bg-emerald-600 text-white" : "bg-stone-200/70 text-stone-700"}`;

  return (
    <div className="page-enter">
      <div className="space-y-4 px-4 pb-28 pt-[calc(1rem+env(safe-area-inset-top))]">
        <h1 className="text-[28px] font-bold">{t("Recherche")}</h1>
        <label className="relative block">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-500">
            <Icon name="search" className="h-5 w-5" />
          </span>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("Un plat, un restaurant…")}
            aria-label={t("Rechercher un plat ou un restaurant")}
            className="w-full rounded-2xl bg-white py-3 pl-11 pr-10 text-[16px] shadow-[0_1px_2px_rgb(0_0_0/0.06)] outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-emerald-600/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" onClick={() => setText("")} aria-label={t("Effacer")} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400">
              <Icon name="close" className="h-4 w-4" />
            </button>
          )}
        </label>

        {categories.length > 0 && (
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={t("Catégories")} data-noswipe>
            {[{ key: "", label: "Tout", emoji: "🍽️" }, ...categories].map((c) => {
              const on = (category ?? "") === c.key;
              return (
                <button key={c.key} type="button" onClick={() => setCategory(c.key && category !== c.key ? c.key : null)} aria-pressed={on} className="flex w-[68px] shrink-0 flex-col items-center gap-1">
                  <span className={`grid h-[68px] w-[68px] place-items-center rounded-[18px] text-[30px] ${on ? "bg-emerald-600 shadow-[0_6px_16px_rgb(5_150_105/0.35)]" : "bg-white shadow-[0_1px_2px_rgb(0_0_0/0.06)]"}`} aria-hidden="true">
                    {c.emoji}
                  </span>
                  <span className={`text-[13px] ${on ? "font-semibold text-emerald-700" : "text-stone-700"}`}>{t(c.label)}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={t("Filtres")} data-noswipe>
          <button onClick={() => setOpenOnly((v) => !v)} aria-pressed={openOnly} className={chip(openOnly)}>
            {t("Ouvert maintenant")}
          </button>
          <button onClick={() => setFreeOnly((v) => !v)} aria-pressed={freeOnly} className={chip(freeOnly)}>
            {t("Livraison offerte")}
          </button>
          <button onClick={() => setSort(sort === "top" ? "default" : "top")} aria-pressed={sort === "top"} className={chip(sort === "top")}>
            {t("Les plus notés")}
          </button>
          <button onClick={() => (sort === "near" ? setSort("default") : near())} aria-pressed={sort === "near"} className={chip(sort === "near")}>
            {locating ? t("Localisation…") : t("Près de moi")}
          </button>
          <button onClick={() => setSort(sort === "fast" ? "default" : "fast")} aria-pressed={sort === "fast"} className={chip(sort === "fast")}>
            {t("Les plus rapides")}
          </button>
        </div>

        {results.loading || !results.data ? (
          <Skeleton />
        ) : list.length === 0 ? (
          <Empty icon="search" title="Aucun restaurant">
            {q.length >= 2 ? t("Essayez un autre mot, par exemple le nom d'un plat.") : t("Retirez un filtre pour voir plus de restaurants.")}
          </Empty>
        ) : (
          <div>
            <p className="text-sm text-stone-500">{t("{n} restaurant(s)", { n: list.length })}</p>
            <div className="divide-y divide-stone-200/70">
              {list.map((r) => (
                <RestaurantCard key={r.slug} r={r} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
