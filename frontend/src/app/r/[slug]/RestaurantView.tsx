"use client";

import { DialogBox } from "@/components/DialogBox";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { daySummary, WEEK } from "@/components/panel/OpeningHoursEditor";
import { DAYS } from "@/lib/restaurant";
import { fcfa, type MenuItem, type Restaurant } from "@/lib/api";
import { distanceKm, km, usePosition } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { FAVORITES_KEY, useStored, writeStored } from "@/lib/device";
import { initials, patternClass } from "@/lib/pattern";
import ItemDialog from "./ItemDialog";
import { describe, fromPrice, unitPrice, useRestaurantCart } from "./useRestaurantCart";
import { THUMB_SIDE, thumbOf } from "@/lib/media";

type Cart = ReturnType<typeof useRestaurantCart>;

const slugOf = (c: string) =>
  `cat-${c
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")}`;

// Horaires de la semaine, repliés : la ligne du jour reste visible. Lomé est à UTC+0, le jour UTC est le jour local.
function WeekHours({ hours }: { hours: { day: number; open: string; close: string }[] }) {
  const t = useT();
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => setToday(new Date().getUTCDay()), []);
  if (hours.length === 0) return null;
  const line = (day: number) => daySummary(hours, day) || t("Fermé");
  return (
    <details className="group mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <Icon name="clock" className="h-4 w-4" />
        {today === null ? t("Horaires d'ouverture") : t("Aujourd'hui : {hours}", { hours: line(today) })}
        <span className="ml-auto text-xs text-emerald-700 group-open:hidden">{t("Voir la semaine")}</span>
      </summary>
      <ul className="mt-2 space-y-1">
        {WEEK.map((day) => (
          <li key={day} className={`flex justify-between gap-3 ${day === today ? "font-semibold text-ink" : ""}`}>
            <span>{t(DAYS[day])}</span>
            <span className="text-right">{line(day)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Page d'un restaurant : en-tête, onglets de catégories qui suivent le défilement, plats en grille,
// panier fixe à droite sur grand écran et barre en bas sur téléphone.
// table : carte ouverte depuis le QR code d'une table (commande sur place, servie à table).
export type TableContext = { number: number; token: string };

export default function RestaurantView({ restaurant, table }: { restaurant: Restaurant; table?: TableContext }) {
  const cart = useRestaurantCart(restaurant);
  const position = usePosition();
  const distance = position ? distanceKm(position, restaurant) : null;
  const [opened, setOpened] = useState<MenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const open = restaurant.availability.open;
  const t = useT();
  const router = useRouter();
  const favorites = useStored<string[]>(FAVORITES_KEY) ?? [];
  const favorite = favorites.includes(restaurant.slug);
  const toggleFavorite = () => writeStored(FAVORITES_KEY, favorite ? favorites.filter((s) => s !== restaurant.slug) : [restaurant.slug, ...favorites]);
  const cover = restaurant.coverUrl ?? null;
  // Pourcentage sur toute la carte, sans minimum : prix remisés, l'ancien barré (le serveur applique la remise).
  const pct = restaurant.promo?.kind === "PERCENT" && !restaurant.promo.minSubtotal && !restaurant.promo.maxDiscount ? restaurant.promo.value : 0;
  const struck = pct > 0;
  const reduced = (price: number) => (pct ? Math.round((price * (100 - pct)) / 100) : price);
  const facts = [
    restaurant.rating ? `★ ${restaurant.rating.avg.toFixed(1).replace(".", ",")} (${restaurant.rating.count})` : null,
    `${restaurant.deliveryTimeMin}–${restaurant.deliveryTimeMax} min`,
    distance !== null ? km(distance) : null,
  ].filter(Boolean);

  const categories = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of restaurant.menuItems) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    return [...groups];
  }, [restaurant.menuItems]);

  // Onglet actif = la catégorie en haut de l'écran.
  const [active, setActive] = useState(categories[0]?.[0] ?? "");
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.getAttribute("data-category") ?? "");
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    document.querySelectorAll("[data-category]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [categories]);
  useEffect(() => {
    tabs.current?.querySelector(`[data-tab="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(null), 1800);
    return () => clearTimeout(timer);
  }, [added]);

  function quickAdd(item: MenuItem) {
    if (item.variants.length || item.addons.length) setOpened(item);
    else if (cart.add(item, undefined, [])) setAdded(item.name);
  }

  return (
    <div className="pb-24 lg:pb-0">
      <nav aria-label={t("Fil d'Ariane")} className="mb-3 hidden text-sm text-stone-500 sm:block">
        <Link href="/app" className="hover:underline">
          {t("Accueil")}
        </Link>{" "}
        ›{" "}
        <Link href="/app/recherche" className="hover:underline">
          {t("Restaurants")}
        </Link>{" "}
        › <span className="text-stone-700">{restaurant.name}</span>
      </nav>

      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-6">
        <div className="min-w-0">
          {/* Photo de couverture, boutons ronds par-dessus, puis la carte d'identité qui la chevauche. */}
          <header className="-mx-4 sm:mx-0">
            <div className={`relative h-56 overflow-hidden sm:h-64 sm:rounded-[12px] ${cover ? "bg-stone-200" : patternClass(restaurant.name)} ${open ? "" : "grayscale"}`}>
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element -- photo d'un plat du restaurant, décorative
                <img src={cover} alt="" decoding="async" className="h-full w-full object-cover" />
              )}
              <div className="absolute inset-x-0 top-0 flex justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                <button
                  type="button"
                  onClick={() => (window.history.length > 1 ? router.back() : router.push("/app"))}
                  aria-label={t("Retour")}
                  className="grid h-11 w-11 place-items-center rounded-full bg-surface text-stone-800 shadow-md sm:hidden"
                >
                  <Icon name="back" className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={toggleFavorite}
                  aria-pressed={favorite}
                  aria-label={favorite ? t("Retirer des favoris") : t("Ajouter aux favoris")}
                  className={`ml-auto grid h-11 w-11 place-items-center rounded-full bg-surface text-[20px] shadow-md ${favorite ? "text-red-500" : "text-stone-700"}`}
                >
                  {favorite ? "♥" : "♡"}
                </button>
              </div>
            </div>
            <div className="relative mx-4 -mt-16 card-gloss rounded-[12px] bg-surface/95 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                {restaurant.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo fourni par le restaurant
                  <img src={restaurant.logoUrl} alt={t("Logo de {name}", { name: restaurant.name })} decoding="async" className={`h-14 w-14 shrink-0 rounded-2xl object-cover ring-1 ring-stone-200 ${open ? "" : "grayscale"}`} />
                ) : (
                  <span className={`${patternClass(restaurant.name)} font-display relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl`}>
                    <span className="rounded-md bg-surface/90 px-1 text-[13px] font-extrabold text-ink">{initials(restaurant.name)}</span>
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h1 className="text-[22px] font-bold leading-tight">{restaurant.name}</h1>
                  <p className="text-[14px] text-stone-500">{facts.join(" · ")}</p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${open ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}>{open ? t("Ouvert") : t("Fermé")}</span>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-stone-500">
                <span>
                  {restaurant.address}
                  {restaurant.zone ? ` · ${restaurant.zone.name.split(" (")[0]}` : ""}
                </span>
                <span>· {restaurant.minOrderAmount > 0 ? t("Minimum {amount}", { amount: fcfa(restaurant.minOrderAmount) }) : t("Pas de minimum")}</span>
              </p>
              {restaurant.promo && (
                <p className="mt-3 flex items-center gap-2 rounded-[10px] bg-emerald-50 px-3 py-3 text-[14px] font-semibold text-emerald-800 ring-1 ring-emerald-600/15">
                  <span aria-hidden="true">🏷️</span>
                  <span className="flex-1">{restaurant.promo.title || restaurant.promo.label}</span>
                  {restaurant.promo.endsAt && (
                    <span className="shrink-0 text-[13px]">
                      {t("jusqu'au {date}", { date: new Date(restaurant.promo.endsAt).toLocaleDateString([], { day: "numeric", month: "short" }) })}
                    </span>
                  )}
                </p>
              )}
              <WeekHours hours={restaurant.openingHours ?? []} />
              {!open && (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>{t("Fermé pour le moment.")}</strong> {restaurant.availability.reason} {t("Vous pouvez consulter la carte, mais pas commander.")}
                </p>
              )}
              {table && (
                <p className="mt-3 flex items-center gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                  <span className="grid h-11 min-w-11 shrink-0 place-items-center rounded-xl bg-emerald-600 px-2 text-lg font-bold text-white">{table.number}</span>
                  <span>
                    <strong>{t("Table {number} · sur place", { number: table.number })}</strong>
                    <br />
                    {t("Commandez ici, le restaurant vous apporte votre commande à table.")}
                  </span>
                </p>
              )}
            </div>
          </header>

          {cart.otherCart && (
            <p className="mt-3 rounded-xl bg-stone-100 p-3 text-sm text-stone-700">
              {t("Votre panier contient des plats de")}{" "}
              <Link href={`/r/${cart.otherCart.slug}`} className="font-medium text-emerald-700 underline">
                {cart.otherCart.name}
              </Link>
              . {t("Un panier ne peut contenir qu'un seul restaurant.")}
            </p>
          )}

          <div
            ref={tabs}
            role="tablist"
            aria-label={t("Catégories de la carte")}
            className="sticky top-0 z-20 -mx-4 mt-4 flex gap-6 overflow-x-auto border-b border-stone-200 glass px-4 [scrollbar-width:none] sm:top-[52px] [&::-webkit-scrollbar]:hidden"
          >
            {/* Onglets soulignés : la rubrique visible est en vert. */}
            {categories.map(([c]) => (
              <a
                key={c}
                href={`#${slugOf(c)}`}
                data-tab={c}
                role="tab"
                aria-selected={active === c}
                onClick={() => setActive(c)}
                className={`-mb-px min-w-11 shrink-0 border-b-[3px] py-3 text-center text-[15px] font-semibold transition ${active === c ? "border-emerald-600 text-emerald-700" : "border-transparent text-stone-500"}`}
              >
                {c}
              </a>
            ))}
          </div>

          {categories.map(([category, items]) => (
            <section key={category} id={slugOf(category)} data-category={category} className="scroll-mt-16 pt-5 sm:scroll-mt-28">
              <h2 className="text-[20px] font-bold">{category}</h2>
              <ul className="divide-y divide-stone-200/80 lg:grid lg:grid-cols-2 lg:gap-x-8 lg:divide-y-0">
                {items.map((item) => {
                  const n = cart.countFor(item.id);
                  return (
                    <li key={item.id} className="flex gap-3 py-4 lg:border-b lg:border-stone-200/80">
                      <button type="button" onClick={() => setOpened(item)} className="min-w-0 flex-1 text-left" aria-label={t("Voir {name}", { name: item.name })}>
                        <span className="block text-[17px] font-semibold leading-snug">{item.name}</span>
                        {item.description && <span className="line-clamp-2 block text-[14px] text-stone-500">{item.description}</span>}
                        <span className="mt-2 block text-[16px] font-bold">
                          {item.variants.length ? t("dès {price}", { price: fcfa(reduced(fromPrice(item))) }) : fcfa(reduced(item.price))}
                          {struck && <s className="ml-2 text-[13px] font-normal text-stone-400">{fcfa(item.variants.length ? fromPrice(item) : item.price)}</s>}
                        </span>
                      </button>
                      <span className="relative shrink-0">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- photos fournies par les restaurants ; décorative : le bouton porte déjà le nom du plat
                          <img src={thumbOf(item.imageUrl)} alt="" loading="lazy" decoding="async" width={THUMB_SIDE} height={THUMB_SIDE} onClick={() => setOpened(item)} className="h-[104px] w-[104px] cursor-pointer rounded-2xl object-cover" />
                        ) : (
                          <span className="block h-[104px] w-10" aria-hidden="true" />
                        )}
                        {open && (
                          <button
                            type="button"
                            onClick={() => quickAdd(item)}
                            aria-label={n > 0 ? t("Ajouter encore {name} ({n} dans le panier)", { name: item.name, n }) : t("Ajouter {name}", { name: item.name })}
                            className={`hit absolute -bottom-1.5 -right-1.5 grid h-9 min-w-9 place-items-center rounded-full px-2 font-semibold shadow-md ring-2 ring-white transition active:scale-90 ${n > 0 ? "bg-emerald-600 text-white" : "bg-surface text-emerald-700"}`}
                          >
                            {n > 0 ? (
                              <span key={n} className="anim-bump text-sm">
                                {n}
                              </span>
                            ) : (
                              <Icon name="plus" className="h-5 w-5" />
                            )}
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-4">
            <CartPanel restaurant={restaurant} table={table} cart={cart} />
          </div>
        </aside>
      </div>

      {added && (
        // Sur téléphone, la barre du panier qui s'anime suffit : le message passerait sur les plats.
        <p role="status" className="fixed inset-x-0 bottom-20 z-40 mx-auto w-max rounded-full max-lg:sr-only bg-night px-4 py-2 text-sm text-white shadow-lg lg:bottom-6">
          {t("{name} ajouté au panier", { name: added })}
        </p>
      )}

      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
          <button onClick={() => setCartOpen(true)} className="anim-slide-up sheen mx-auto flex w-full max-w-2xl items-center justify-center gap-2 rounded-2xl bg-[#0a6a3f] px-5 py-4 text-[17px] font-semibold text-white shadow-[0_8px_30px_rgb(4_120_87/0.35)] active:scale-[0.98]">
            <span key={cart.count} className="anim-bump">
              {t("Voir le panier · {n} article(s) · {total}", { n: cart.count, total: fcfa(cart.subtotal) })}
            </span>
          </button>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 lg:hidden" onClick={() => setCartOpen(false)}>
          <DialogBox onClose={() => setCartOpen(false)} aria-label={t("Panier")} onClick={(e) => e.stopPropagation()} className="anim-slide-up max-h-[85vh] w-full overflow-y-auto rounded-t-[14px] bg-surface pt-2">
            <div className="mx-auto h-[5px] w-9 rounded-full bg-stone-300" aria-hidden="true" />
            <CartPanel restaurant={restaurant} table={table} cart={cart} onClose={() => setCartOpen(false)} />
          </DialogBox>
        </div>
      )}

      {opened && (
        <ItemDialog
          key={opened.id}
          item={opened}
          open={open}
          onClose={() => setOpened(null)}
          onAdd={(variantId, addonIds, quantity) => {
            if (cart.add(opened, variantId, addonIds, quantity)) setAdded(opened.name);
            setOpened(null);
          }}
        />
      )}
    </div>
  );
}

function CartPanel({ restaurant, table, cart, onClose }: { restaurant: Restaurant; table?: TableContext; cart: Cart; onClose?: () => void }) {
  // À table, pas de minimum de commande.
  const missing = table ? 0 : restaurant.minOrderAmount - cart.subtotal;
  const t = useT();
  return (
    <section className="rounded-[12px] bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[22px] font-bold">{t("Panier")}</h2>
        {onClose && (
          <button onClick={onClose} aria-label={t("Fermer le panier")} className="grid h-8 w-8 place-items-center rounded-full bg-stone-100 text-stone-500">
            <Icon name="close" className="h-5 w-5" />
          </button>
        )}
      </div>
      {cart.count === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500">{t("Votre panier est vide. Touchez « + » sur un plat pour l'ajouter.")}</p>
      ) : (
        <>
          <ul className="divide-y divide-stone-100 text-sm">
            {cart.lines.map((l) => (
              <li key={l.key} className="py-2">
                <div className="flex justify-between gap-2">
                  <span>{describe(l)}</span>
                  <span className="shrink-0 font-medium">{fcfa(unitPrice(l.item, l.variantId, l.addonIds) * l.quantity)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={() => cart.change(l.key, -1)} aria-label={t("Retirer {name}", { name: describe(l) })} className="hit grid h-7 w-7 place-items-center rounded-full bg-stone-100 text-stone-700">
                    −
                  </button>
                  <span className="w-5 text-center">{l.quantity}</span>
                  <button onClick={() => cart.change(l.key, 1)} aria-label={t("Ajouter encore {name}", { name: describe(l) })} className="hit grid h-7 w-7 place-items-center rounded-full bg-stone-100 text-stone-700">
                    +
                  </button>
                  <button onClick={() => cart.remove(l.key)} aria-label={t("Supprimer {label}", { label: describe(l) })} className="ml-auto text-stone-500 hover:text-red-600">
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-stone-100 pt-3 font-semibold">
            <span>{t("Sous-total")}</span>
            <span>{fcfa(cart.subtotal)}</span>
          </div>
          <p className="mt-1 text-xs text-stone-500">{table ? t("Servi à votre table, sans frais de livraison.") : t("Frais de livraison calculés à l'étape suivante.")}</p>
          {missing > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              {t("Encore {amount} pour atteindre le minimum de {min}.", { amount: fcfa(missing), min: fcfa(restaurant.minOrderAmount) })}
            </p>
          )}
          {restaurant.availability.open && missing <= 0 ? (
            <Link href={table ? `/t/${table.token}/commande` : `/r/${restaurant.slug}/commande`} className="mt-4 block rounded-2xl bg-emerald-600 px-4 py-4 text-center text-[17px] font-semibold text-white active:scale-[0.98]">
              {t("Commander")}
            </Link>
          ) : (
            <button disabled className="mt-4 w-full rounded-2xl bg-stone-200 px-4 py-4 text-[17px] font-semibold text-stone-500">
              {restaurant.availability.open ? t("Minimum {amount}", { amount: fcfa(restaurant.minOrderAmount) }) : t("Restaurant fermé")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
