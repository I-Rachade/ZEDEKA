"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { InstallPrompt } from "@/components/AppRuntime";
import { Icon } from "@/components/panel/icons";
import { distanceKm, usePlace, usePosition, useSession, type AppRestaurant } from "@/lib/customer";
import { FAVORITES_KEY, useHydrated, useStored } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { useRestaurants } from "./data";
import AdCarousel from "./AdCarousel";
import Offers from "./Offers";
import { CUISINES } from "./cuisines";
import PlacePicker from "./PlacePicker";
import { Empty, RestaurantCard, RestaurantTile, Skeleton } from "./ui";

// Initiales du nom, ou les deux derniers chiffres du numéro tant que le nom n'est pas renseigné.
const initialsOf = (name: string | null, phone: string) =>
  name
    ?.split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || phone.slice(-2);

// Délai annoncé au plus pour la rangée « Livraison rapide ».
const FAST_MIN = 30;

// Accueil réservé aux restaurants : en-tête vert (adresse, recherche, bannière), tuiles de catégories,
// rangées thématiques qui défilent de côté, puis la liste complète. La commande en cours flotte au-dessus des onglets.
export default function AppHome() {
  const hydrated = useHydrated();
  const session = useSession();
  const place = usePlace();
  const position = usePosition();
  const restaurants = useRestaurants(place?.zoneId);
  const [cuisine, setCuisine] = useState<string | null>(null);
  const favorites = useStored<string[]>(FAVORITES_KEY);
  const t = useT();

  const all = restaurants.data ?? [];
  // Tuiles proposées : seulement les catégories qui ont au moins un restaurant.
  const tiles = CUISINES.filter((c) => all.some((r) => r.cuisines?.includes(c.key)));
  const list = cuisine ? all.filter((r) => r.cuisines?.includes(cuisine)) : all;
  const open = list.filter((r) => r.availability.open);

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
    const liked = (favorites ?? []).map((slug) => list.find((r) => r.slug === slug)).filter((r): r is AppRestaurant => Boolean(r));
    return [
      { key: "favorites", title: t("Vos favoris"), items: liked, min: 1 },
      { key: "fast", title: t("Livraison rapide · {n} min ou moins", { n: FAST_MIN }), items: fast },
      { key: "free", title: t("Livraison offerte"), items: free },
      { key: "near", title: position ? t("Près de vous") : t("Dans votre zone"), items: near },
      { key: "top", title: t("Les mieux notés"), items: top },
    ].filter((row) => row.items.length >= ("min" in row ? (row.min ?? 2) : 2));
  }, [open, list, favorites, position, t]);

  return (
    <div className="page-enter">
      <header className="hero-shine rounded-b-[28px] px-4 pb-5 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white">
        <div className="flex items-center gap-3">
          <Link
            href={session ? "/app/profil" : "/app/connexion"}
            aria-label={session ? t("Mon profil") : t("Se connecter")}
            className="deep-sun grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sun text-[15px] font-bold text-ink"
          >
            {session ? initialsOf(session.name, session.phone) : <Icon name="user" className="h-5 w-5" />}
          </Link>
          <div className="min-w-0 flex-1">
            <PlacePicker onGreen />
          </div>
          <Link href="/app/commandes" aria-label={t("Mes commandes")} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-sun shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] backdrop-blur">
            <Icon name="bell" className="h-5 w-5" />
          </Link>
        </div>
        <Link href="/app/recherche" className="mt-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-[15px] text-stone-500 shadow-sm">
          <Icon name="search" className="h-4.5 w-4.5" /> {t("Restaurants ou plats…")}
        </Link>
        <div className="mt-3">
          <AdCarousel />
        </div>
      </header>

      <div className="stagger space-y-6 pb-28 pt-5">
        {tiles.length > 0 && (
          <section className="space-y-3">
            <SectionTitle title={t("Catégories")} href="/app/recherche" />
            <div className="flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-noswipe>
              <Tile emoji="🍽️" label={t("Tout")} on={!cuisine} onClick={() => setCuisine(null)} />
              {tiles.map((c) => (
                <Tile key={c.key} emoji={c.emoji} label={t(c.label)} on={cuisine === c.key} onClick={() => setCuisine(cuisine === c.key ? null : c.key)} />
              ))}
            </div>
          </section>
        )}

        <Offers />

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
            {rows.map((row) => (
              <section key={row.key} className="space-y-3">
                <SectionTitle title={row.title} />
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

            <section className="px-4">
              <div className="flex items-end justify-between">
                <h2 className="text-[20px] font-bold">{cuisine ? t(CUISINES.find((c) => c.key === cuisine)?.label ?? "") : t("Tous les restaurants")}</h2>
                {!place && hydrated && (
                  <button
                    type="button"
                    onClick={() => document.querySelector<HTMLButtonElement>("[data-place-picker]")?.click()}
                    className="inline-flex items-center gap-1 text-[14px] font-medium text-emerald-700"
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
              {list.length === 0 && <Empty icon="store" title="Aucun restaurant dans cette catégorie" />}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title, href }: { title: string; href?: string }) {
  const t = useT();
  return (
    <div className="flex items-end justify-between gap-3 px-4">
      <h2 className="text-[20px] font-bold leading-tight">{title}</h2>
      {href && (
        <Link href={href} className="shrink-0 text-[14px] font-semibold text-emerald-700">
          {t("Tout voir")}
        </Link>
      )}
    </div>
  );
}

function Tile({ emoji, label, on, onClick }: { emoji: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="flex w-[76px] shrink-0 snap-start flex-col items-center gap-1.5">
      <span className={`grid h-[76px] w-[76px] place-items-center rounded-[20px] text-[34px] transition ${on ? "deep-green" : "card-gloss"}`} aria-hidden="true">
        {emoji}
      </span>
      <span className={`text-[13px] ${on ? "font-semibold text-emerald-700" : "text-stone-700"}`}>{label}</span>
    </button>
  );
}
