"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { distanceKm, locateMe, usePlace, usePosition } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { useRestaurants } from "../data";
import { Empty, input, RestaurantCard, Skeleton, TopBar } from "../ui";

type Sort = "default" | "near" | "fast";

// Repas : recherche, catégories en pastilles, filtres « ouvert » et « livraison gratuite », tri.
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

  // Pastilles : les catégories de plats les plus répandues chez les restaurants.
  const categories = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of results.data ?? []) for (const c of r.categories) count.set(c, (count.get(c) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c).slice(0, 12);
  }, [results.data]);

  const list = useMemo(() => {
    const rows = (results.data ?? []).filter(
      (r) => (!category || r.categories.includes(category)) && (!openOnly || r.availability.open) && (!freeOnly || r.deliveryFee === 0),
    );
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

  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-sm ring-1 ${on ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-stone-700 ring-stone-200"}`;

  return (
    <div>
      <TopBar title="Repas" />
      <div className="space-y-4 px-4 py-4">
        <label className="relative block">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
            <Icon name="search" />
          </span>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("Un plat, un restaurant…")}
            aria-label={t("Rechercher un plat ou un restaurant")}
            className={`${input} pl-10`}
          />
        </label>

        {categories.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={t("Catégories")}>
            <button onClick={() => setCategory(null)} aria-pressed={!category} className={chip(!category)}>
              {t("Tout")}
            </button>
            {categories.map((c) => (
              <button key={c} onClick={() => setCategory(category === c ? null : c)} aria-pressed={category === c} className={chip(category === c)}>
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={t("Filtres")}>
          <button onClick={() => setOpenOnly((v) => !v)} aria-pressed={openOnly} className={chip(openOnly)}>
            {t("Ouvert maintenant")}
          </button>
          <button onClick={() => setFreeOnly((v) => !v)} aria-pressed={freeOnly} className={chip(freeOnly)}>
            {t("Livraison gratuite")}
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
          <div className="space-y-3">
            <p className="text-sm text-stone-500">{t("{n} restaurant(s)", { n: list.length })}</p>
            {list.map((r) => (
              <RestaurantCard key={r.slug} r={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
