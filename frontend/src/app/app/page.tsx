"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { InstallPrompt } from "@/components/AppRuntime";
import { Icon } from "@/components/panel/icons";
import { distanceKm, usePlace, usePosition, useSession, type AppRestaurant } from "@/lib/customer";
import { FAVORITES_KEY, useHydrated, useStored, writeStored } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { useRestaurants } from "./data";
import AdCarousel from "./AdCarousel";
import Offers from "./Offers";
import { CUISINES } from "./cuisines";
import PlacePicker from "./PlacePicker";
import { Cover, Empty, Facts, RestaurantCard, RestaurantTile, Skeleton } from "./ui";

// Initiales du nom, ou les deux derniers chiffres du numéro tant que le nom n'est pas renseigné.
const initialsOf = (name: string | null, phone: string) =>
  name
    ?.split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || phone.slice(-2);

// Délai annoncé au plus pour la rangée « Livraison rapide » et le filtre « Rapide ».
const FAST_MIN = 30;
// Note minimale du filtre « 4,5+ ».
const TOP_RATING = 4.5;

// Filtres en pastilles sous la bannière ; ils s'ajoutent à la catégorie choisie. « Offres » est le premier rond.
type Chip = "favorites" | "offers" | "fast" | "free" | "top";
const CHIPS: { key: Chip; label: string; icon?: "heart" }[] = [
  { key: "favorites", label: "Favoris", icon: "heart" },
  { key: "fast", label: "Rapide" },
  { key: "free", label: "Livraison offerte" },
  { key: "top", label: "4,5+ ★" },
];

const hasOffer = (r: AppRestaurant) => Boolean(r.promoBadge) || r.deliveryFee === 0;

// Accueil restaurants : en-tête vert (« Livrer à », recherche avec choix de catégorie), puis une feuille blanche
// arrondie : catégories en ronds, bannière, filtres en pastilles, « À la une sur Zedeka » en grandes cartes,
// offres, rangées thématiques et la liste complète. La commande en cours flotte au-dessus des onglets.
export default function AppHome() {
  const hydrated = useHydrated();
  const session = useSession();
  const place = usePlace();
  const position = usePosition();
  const restaurants = useRestaurants(place?.zoneId);
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const favorites = useStored<string[]>(FAVORITES_KEY);
  const t = useT();

  const all = useMemo(() => restaurants.data ?? [], [restaurants.data]);
  // Catégories proposées : seulement celles qui ont au moins un restaurant.
  const tiles = CUISINES.filter((c) => all.some((r) => r.cuisines?.includes(c.key)));
  const toggle = (c: Chip) => setChips((on) => (on.includes(c) ? on.filter((x) => x !== c) : [...on, c]));

  const list = useMemo(() => {
    const liked = favorites ?? [];
    return all.filter(
      (r) =>
        (!cuisine || r.cuisines?.includes(cuisine)) &&
        chips.every((c) =>
          c === "favorites"
            ? liked.includes(r.slug)
            : c === "offers"
              ? hasOffer(r)
              : c === "fast"
                ? r.deliveryTimeMax <= FAST_MIN
                : c === "free"
                  ? r.deliveryFee === 0
                  : (r.rating?.avg ?? 0) >= TOP_RATING,
        ),
    );
  }, [all, cuisine, chips, favorites]);
  const open = list.filter((r) => r.availability.open);

  // « À la une » : remises d'abord, puis les mieux notés, ceux avec une photo avant les autres.
  const featured = useMemo(
    () =>
      [...open].sort(
        (a, b) =>
          Number(Boolean(b.promoBadge)) - Number(Boolean(a.promoBadge)) ||
          Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl)) ||
          (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0),
      ),
    [open],
  );

  const rows = useMemo(() => {
    const fast = [...open].filter((r) => r.deliveryTimeMax <= FAST_MIN).sort((a, b) => a.deliveryTimeMax - b.deliveryTimeMax);
    const free = open.filter((r) => r.deliveryFee === 0);
    const near = position
      ? open
          .filter((r) => r.latitude !== null && r.longitude !== null)
          .map((r) => ({ r, d: distanceKm(position, r) ?? 1e9 }))
          .sort((a, b) => a.d - b.d)
          .map((x) => x.r)
      : open.filter((r) => r.sameZone);
    const top = [...open].filter((r) => (r.rating?.count ?? 0) >= 3).sort((a, b) => (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0));
    return [
      { key: "fast", title: t("Livraison rapide · {n} min ou moins", { n: FAST_MIN }), items: fast },
      { key: "free", title: t("Livraison offerte"), items: free },
      { key: "near", title: position ? t("Près de vous") : t("Dans votre zone"), items: near },
      { key: "top", title: t("Les mieux notés"), items: top },
    ].filter((row) => row.items.length >= 2);
  }, [open, position, t]);

  const filtered = Boolean(cuisine) || chips.length > 0;
  const cuisineLabel = cuisine ? t(CUISINES.find((c) => c.key === cuisine)?.label ?? "") : t("Tout");

  return (
    <div className="page-enter">
      <header className="hero-shine px-4 pb-10 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <PlacePicker onGreen />
          </div>
          <Link href="/app/commandes" aria-label={t("Mes commandes")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15 text-sun shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] backdrop-blur">
            <Icon name="bell" className="h-5 w-5" />
          </Link>
          <Link
            href={session ? "/app/profil" : "/app/connexion"}
            aria-label={session ? t("Mon profil") : t("Se connecter")}
            className="deep-sun grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sun text-[15px] font-bold text-ink-deep"
          >
            {session ? initialsOf(session.name, session.phone) : <Icon name="user" className="h-5 w-5" />}
          </Link>
        </div>
        {/* Recherche : le champ ouvre la page Recherche ; la pastille de droite choisit la catégorie de l'accueil. */}
        <div data-home-search className="mt-4 flex items-center gap-2 rounded-2xl bg-surface p-1.5 pl-4 text-stone-500 shadow-[0_6px_20px_rgb(0_0_0/0.15)]">
          <Link href="/app/recherche" className="flex min-w-0 flex-1 items-center gap-2 py-2 text-[15px]">
            <Icon name="search" className="h-5 w-5 shrink-0 text-ink" />
            <span className="truncate">{t("Restaurants ou plats…")}</span>
          </Link>
          <label className="relative flex shrink-0 items-center gap-1.5 rounded-xl bg-stone-100 px-3 py-2 text-[14px] font-semibold text-ink">
            <Icon name="grid" className="h-4 w-4" />
            <span className="max-w-[80px] truncate">{cuisineLabel}</span>
            <span className="rotate-90">
              <Icon name="chevron" className="h-3.5 w-3.5" />
            </span>
            <select
              aria-label={t("Catégorie")}
              value={cuisine ?? ""}
              onChange={(e) => setCuisine(e.target.value || null)}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              <option value="">{t("Tout")}</option>
              {tiles.map((c) => (
                <option key={c.key} value={c.key}>
                  {t(c.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="relative -mt-6 min-h-[60vh] rounded-t-[28px] bg-surface pb-28 pt-5">
        <div className="stagger space-y-6">
          {tiles.length > 0 && (
            <div className="flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-noswipe>
              <Round label={t("Offres")} on={chips.includes("offers")} onClick={() => toggle("offers")} offer />
              {tiles.map((c) => (
                <Round key={c.key} emoji={c.emoji} label={t(c.label)} on={cuisine === c.key} onClick={() => setCuisine(cuisine === c.key ? null : c.key)} />
              ))}
            </div>
          )}

          <div className="px-4">
            <AdCarousel light />
          </div>

          <div className="flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-noswipe>
            <button
              type="button"
              onClick={() => {
                setChips([]);
                setCuisine(null);
              }}
              aria-label={filtered ? t("Effacer les filtres") : t("Filtres")}
              className={`relative grid h-10 w-11 shrink-0 place-items-center rounded-xl border transition ${filtered ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 text-ink"}`}
            >
              <Icon name={filtered ? "close" : "sliders"} className="h-4.5 w-4.5" />
            </button>
            {CHIPS.map((c) => {
              const on = chips.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggle(c.key)}
                  aria-pressed={on}
                  className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[14px] font-semibold transition active:scale-[0.97] ${on ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-stone-200 text-ink"}`}
                >
                  {c.icon && <Icon name={c.icon} className={`h-4 w-4 ${c.icon === "heart" ? "fill-coral text-coral" : ""}`} />}
                  {t(c.label)}
                </button>
              );
            })}
          </div>

          {restaurants.loading || !restaurants.data ? (
            <div className="px-4">
              {restaurants.error ? (
                <Empty icon="store" title="Liste indisponible">
                  {restaurants.error}{" "}
                  <button onClick={restaurants.reload} className="text-emerald-600">
                    {t("Réessayer")}
                  </button>
                </Empty>
              ) : (
                <Skeleton />
              )}
            </div>
          ) : all.length === 0 ? (
            <Empty icon="store" title="Aucun restaurant pour le moment" />
          ) : (
            <>
              {featured.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3 px-4">
                    <h2 className="text-[20px] font-bold leading-tight">{t("À la une sur Zedeka")}</h2>
                    <a href="#tous" aria-label={t("Tous les restaurants")} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-100 text-ink">
                      <Icon name="arrow" className="h-4.5 w-4.5" />
                    </a>
                  </div>
                  <div className="flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-noswipe>
                    {featured.slice(0, 8).map((r) => (
                      <FeaturedCard key={r.slug} r={r} />
                    ))}
                  </div>
                </section>
              )}

              {!filtered && <Offers />}

              {!filtered &&
                rows.map((row) => (
                  <section key={row.key} className="space-y-3">
                    <h2 className="px-4 text-[20px] font-bold leading-tight">{row.title}</h2>
                    <div className="flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-noswipe>
                      {row.items.slice(0, 10).map((r) => (
                        <RestaurantTile key={r.slug} r={r} />
                      ))}
                    </div>
                  </section>
                ))}

              <div className="px-4">
                <InstallPrompt />
              </div>

              <section id="tous" className="scroll-mt-4 px-4">
                <div className="flex items-end justify-between">
                  <h2 className="text-[20px] font-bold">{cuisine ? cuisineLabel : t("Tous les restaurants")}</h2>
                  {!place && hydrated && (
                    <button
                      type="button"
                      onClick={() => document.querySelector<HTMLButtonElement>("[data-place-picker]")?.click()}
                      className="hit inline-flex items-center gap-1 text-[14px] font-medium text-emerald-700"
                    >
                      <Icon name="pin" className="h-3.5 w-3.5" /> {t("Voir les frais de ma zone")}
                    </button>
                  )}
                </div>
                <div className="divide-y divide-stone-200/70">
                  {list.map((r: AppRestaurant) => (
                    <RestaurantCard key={r.slug} r={r} />
                  ))}
                </div>
                {list.length === 0 && <Empty icon="store" title="Aucun restaurant avec ces filtres" />}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Catégorie en rond (photo-emoji sur disque clair), « Offres » en tête avec un macaron %.
function Round({ emoji, label, on, onClick, offer = false }: { emoji?: string; label: string; on: boolean; onClick: () => void; offer?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="flex w-[72px] shrink-0 snap-start flex-col items-center gap-1.5">
      <span
        className={`grid h-[64px] w-[64px] place-items-center rounded-full text-[32px] transition ${on ? "bg-emerald-100 ring-2 ring-emerald-700" : "bg-stone-100"}`}
        aria-hidden="true"
      >
        {offer ? <span className="grid h-11 w-11 rotate-12 place-items-center rounded-[14px] bg-coral text-[22px] font-extrabold text-white">%</span> : emoji}
      </span>
      <span className={`text-[13px] font-semibold ${on ? "text-emerald-700" : "text-ink"}`}>{label}</span>
    </button>
  );
}

// Grande carte « À la une » : photo large, cœur pour les favoris, remise en macaron, nom et cuisines.
function FeaturedCard({ r }: { r: AppRestaurant }) {
  const t = useT();
  const favorites = useStored<string[]>(FAVORITES_KEY) ?? [];
  const liked = favorites.includes(r.slug);
  const kinds = (r.cuisines ?? [])
    .map((k) => CUISINES.find((c) => c.key === k)?.label)
    .filter((l): l is string => Boolean(l))
    .slice(0, 3)
    .map((l) => t(l))
    .join(", ");
  return (
    <div className="relative w-[290px] shrink-0 snap-start">
      <Link href={`/r/${r.slug}`} prefetch={false} className="block transition active:scale-[0.98]">
        <Cover r={r} className="h-[164px] w-full rounded-2xl" />
        {(r.promoBadge || r.deliveryFee === 0) && (
          <span className="absolute left-3 top-3 rounded-lg bg-surface px-2.5 py-1 text-[12px] font-bold text-coral shadow-sm">
            {r.promoBadge ? t(r.promoBadge) : t("Livraison offerte")}
          </span>
        )}
        <span className="mt-2 flex items-center gap-2">
          <span className="truncate text-[17px] font-bold">{r.name}</span>
        </span>
        {kinds && <span className="block truncate text-[14px] text-stone-500">{kinds}</span>}
        <Facts r={r} reviews={false} />
      </Link>
      <button
        type="button"
        onClick={() => writeStored(FAVORITES_KEY, liked ? favorites.filter((s) => s !== r.slug) : [r.slug, ...favorites])}
        aria-pressed={liked}
        aria-label={liked ? t("Retirer des favoris") : t("Ajouter aux favoris")}
        className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-surface text-ink shadow-sm transition active:scale-90"
      >
        <Icon name="heart" className={`h-5 w-5 ${liked ? "fill-coral text-coral" : ""}`} />
      </button>
    </div>
  );
}
