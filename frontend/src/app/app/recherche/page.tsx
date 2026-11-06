"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { distanceKm, locateMe, usePlace, usePosition } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { useRestaurants } from "../data";
import { CUISINES } from "../cuisines";
import { Empty, RestaurantCard, Skeleton } from "../ui";
import Link from "next/link";
import { useModuleText, useServices, type ModuleCode, type ServiceModule } from "@/lib/services";

// Mots qui retrouvent un service même quand son nom n'est pas tapé (« linge » pour la lessive, « moto » pour Zed).
const SERVICE_WORDS: Record<ModuleCode, string> = {
  PARCEL: "colis paquet envoyer envoi expedier parcel package send",
  RIDE: "zed moto taxi course transport deplacement ride",
  ERRAND: "courses achat acheter marche supermarche boutique shopping errand groceries",
  GAS: "gaz bouteille eau bidon gas water",
  LAUNDRY: "lessive linge laver pressing repassage laundry wash",
  CLEANING: "menage nettoyage nettoyer femme de menage cleaning",
  REPAIR: "depannage reparation plombier electricien repair",
};
const foldText = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

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
  // Services du bouton du milieu qui répondent à la recherche (ouverts ou annoncés).
  const services = useServices();
  const moduleText = useModuleText();
  const matchedServices = useMemo(() => {
    if (q.length < 2) return [];
    const needle = foldText(q);
    return services.modules.filter((m) => {
      const x = moduleText(m);
      return foldText(`${x.label} ${x.short} ${x.hint} ${SERVICE_WORDS[m.code] ?? ""}`).includes(needle);
    });
  }, [q, services.modules, moduleText]);

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

  const chip = (on: boolean) => `hit shrink-0 rounded-full px-4 py-2 text-[14px] font-medium ${on ? "bg-emerald-600 text-white" : "bg-stone-200/70 text-stone-700"}`;

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
            placeholder={services.modules.length ? t("Un plat, un restaurant, un service…") : t("Un plat, un restaurant…")}
            aria-label={t("Rechercher un plat ou un restaurant")}
            className="w-full rounded-2xl bg-surface py-3 pl-11 pr-10 text-[16px] shadow-[0_1px_2px_rgb(0_0_0/0.06)] outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-emerald-600/40 [&::-webkit-search-cancel-button]:hidden"
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
                  <span className={`grid h-[68px] w-[68px] place-items-center rounded-[12px] text-[30px] ${on ? "deep-green" : "card-gloss"}`} aria-hidden="true">
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

        {matchedServices.length > 0 && (
          <section aria-label={t("Services")} className="space-y-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-stone-500">{t("Services")}</h2>
            {matchedServices.map((m) => (
              <ServiceResult key={m.code} module={m} label={moduleText(m).label} hint={moduleText(m).hint} />
            ))}
          </section>
        )}

        {results.loading || !results.data ? (
          <Skeleton />
        ) : list.length === 0 ? (
          // Un service a répondu à la recherche : pas de « Aucun restaurant » en grand sous lui.
          matchedServices.length > 0 ? null : <Empty icon="search" title="Aucun restaurant">
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

// Un service trouvé par la recherche : lien quand il est ouvert, grisé avec « Bientôt » sinon.
function ServiceResult({ module, label, hint }: { module: ServiceModule; label: string; hint: string }) {
  const t = useT();
  const body = (
    <>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-stone-100 text-[24px]" aria-hidden="true">
        {module.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{label}</span>
        <span className="block text-[13px] leading-snug text-stone-500">{hint}</span>
      </span>
      {module.state === "SOON" ? (
        <span className="rounded-[6px] bg-stone-200 px-2 py-0.5 text-[11px] font-bold uppercase text-stone-600">{t("Bientôt")}</span>
      ) : (
        <Icon name="chevron" className="h-4 w-4 text-stone-300" />
      )}
    </>
  );
  const cls = "card-gloss flex items-center gap-3 rounded-[12px] p-3";
  return module.state === "ON" && module.href ? (
    <Link href={module.href} className={`${cls} transition active:scale-[0.98]`}>
      {body}
    </Link>
  ) : (
    <div aria-disabled="true" className={`${cls} opacity-70`}>
      {body}
    </div>
  );
}
