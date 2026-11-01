"use client";

import { DialogBox } from "@/components/DialogBox";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { fcfa, type MenuItem, type Restaurant } from "@/lib/api";
import { distanceKm, km, usePosition } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { initials, patternClass } from "@/lib/pattern";
import ItemDialog from "./ItemDialog";
import { describe, fromPrice, unitPrice, useRestaurantCart } from "./useRestaurantCart";

type Cart = ReturnType<typeof useRestaurantCart>;

const slugOf = (c: string) =>
  `cat-${c
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")}`;

// Page d'un restaurant : en-tête, onglets de catégories qui suivent le défilement, plats en grille,
// panier fixe à droite sur grand écran et barre en bas sur téléphone.
export default function RestaurantView({ restaurant }: { restaurant: Restaurant }) {
  const cart = useRestaurantCart(restaurant);
  const position = usePosition();
  const distance = position ? distanceKm(position, restaurant) : null;
  const [opened, setOpened] = useState<MenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const open = restaurant.availability.open;
  const t = useT();

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
          <header className="-mx-4 -mt-6 overflow-hidden bg-white sm:mx-0 sm:mt-0 sm:rounded-[20px]">
            <div className={`${patternClass(restaurant.name)} h-32 sm:h-36 ${open ? "" : "grayscale"}`} aria-hidden="true" />
            <div className="p-4 pt-0">
              <div className="flex items-start gap-3">
                {restaurant.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo fourni par le restaurant
                  <img src={restaurant.logoUrl} alt={t("Logo de {name}", { name: restaurant.name })} className={`-mt-9 h-[72px] w-[72px] shrink-0 rounded-[18px] object-cover shadow-md ring-4 ring-white ${open ? "" : "grayscale"}`} />
                ) : (
                  <span className="font-display -mt-9 grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[18px] bg-white text-xl font-extrabold text-ink shadow-md ring-4 ring-white">
                    {initials(restaurant.name)}
                  </span>
                )}
                <div className="min-w-0 flex-1 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-[28px] font-bold leading-tight">{restaurant.name}</h1>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${open ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}>{open ? t("Ouvert") : t("Fermé")}</span>
                  </div>
                  <p className="text-[15px] text-stone-500">
                    {restaurant.address}
                    {restaurant.zone ? ` · ${restaurant.zone.name.split(" (")[0]}` : ""}
                  </p>
                </div>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2 text-[13px] font-medium text-stone-700">
                <li className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1">
                  <Icon name="clock" className="h-4 w-4" /> {restaurant.deliveryTimeMin}–{restaurant.deliveryTimeMax} min
                </li>
                <li className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1">
                  <Icon name="bag" className="h-4 w-4" /> {restaurant.minOrderAmount > 0 ? t("Minimum {amount}", { amount: fcfa(restaurant.minOrderAmount) }) : t("Pas de minimum")}
                </li>
                {distance !== null && (
                  <li className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1">
                    <Icon name="pin" className="h-4 w-4" /> {km(distance)}
                  </li>
                )}
              </ul>
              {!open && (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>{t("Fermé pour le moment.")}</strong> {restaurant.availability.reason} {t("Vous pouvez consulter la carte, mais pas commander.")}
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
            className="glass sticky top-[52px] z-20 -mx-4 mt-0 px-4 py-2.5 sm:mt-4"
          >
            {/* Contrôle segmenté iOS : fond gris, segment choisi en blanc. */}
            <div className="flex gap-0.5 overflow-x-auto rounded-[10px] bg-stone-200/80 p-0.5">
            {categories.map(([c]) => (
              <a
                key={c}
                href={`#${slugOf(c)}`}
                data-tab={c}
                role="tab"
                aria-selected={active === c}
                onClick={() => setActive(c)}
                className={`min-w-fit flex-1 rounded-[8px] px-3 py-1.5 text-center text-[13px] font-semibold transition ${active === c ? "bg-white text-stone-900 shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-stone-600"}`}
              >
                {c}
              </a>
            ))}
            </div>
          </div>

          {categories.map(([category, items]) => (
            <section key={category} id={slugOf(category)} data-category={category} className="scroll-mt-28 pt-5">
              <h2 className="mb-2.5 text-[22px] font-bold">{category}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => {
                  const n = cart.countFor(item.id);
                  return (
                    <li key={item.id}>
                      <div className="flex h-full gap-3.5 rounded-[20px] bg-white p-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:flex-col">
                        <button type="button" onClick={() => setOpened(item)} className="flex flex-1 gap-3 text-left sm:flex-col" aria-label={t("Voir {name}", { name: item.name })}>
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- photos fournies par les restaurants ; décorative : le bouton porte déjà le nom du plat
                            <img src={item.imageUrl} alt="" className="h-[88px] w-[88px] shrink-0 rounded-[14px] object-cover sm:aspect-[4/3] sm:h-auto sm:w-full" />
                          ) : (
                            <span className={`${patternClass(item.category + item.name)} block h-[88px] w-[88px] shrink-0 rounded-[14px] sm:aspect-[4/3] sm:h-auto sm:w-full`} aria-hidden="true" />
                          )}
                          <span className="min-w-0 flex-1 py-0.5">
                            <span className="block text-[17px] font-semibold leading-snug">{item.name}</span>
                            {item.description && <span className="line-clamp-2 block text-[13px] text-stone-500">{item.description}</span>}
                          </span>
                        </button>
                        <div className="flex flex-col items-end justify-between gap-2 sm:flex-row sm:items-center">
                          <span className="pt-0.5 text-[15px] font-medium text-stone-600">{item.variants.length ? t("dès {price}", { price: fcfa(fromPrice(item)) }) : fcfa(item.price)}</span>
                          {open && (
                            <button
                              type="button"
                              onClick={() => quickAdd(item)}
                              aria-label={n > 0 ? t("Ajouter encore {name} ({n} dans le panier)", { name: item.name, n }) : t("Ajouter {name}", { name: item.name })}
                              className={`grid h-8 min-w-8 place-items-center rounded-full px-2 font-semibold transition active:scale-90 ${n > 0 ? "bg-emerald-600 text-white" : "bg-emerald-600/10 text-emerald-600"}`}
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
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-4">
            <CartPanel restaurant={restaurant} cart={cart} />
          </div>
        </aside>
      </div>

      {added && (
        // Sur téléphone, la barre du panier qui s'anime suffit : le message passerait sur les plats.
        <p role="status" className="fixed inset-x-0 bottom-20 z-40 mx-auto w-max rounded-full max-lg:sr-only bg-stone-900 px-4 py-2 text-sm text-white shadow-lg lg:bottom-6">
          {t("{name} ajouté au panier", { name: added })}
        </p>
      )}

      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
          <button onClick={() => setCartOpen(true)} className="glass-dark anim-slide-up mx-auto flex w-full max-w-2xl items-center gap-3 rounded-full py-2.5 pl-2.5 pr-5 font-semibold text-white shadow-[0_8px_30px_rgb(0_0_0/0.22)] active:scale-[0.98]">
            <span key={cart.count} className="anim-bump grid h-9 min-w-9 place-items-center rounded-full bg-emerald-600 px-1.5 text-sm">
              {cart.count}
            </span>
            <span className="flex-1 text-left">{t("Voir le panier")}</span>
            <span>{fcfa(cart.subtotal)}</span>
          </button>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 lg:hidden" onClick={() => setCartOpen(false)}>
          <DialogBox onClose={() => setCartOpen(false)} aria-label={t("Panier")} onClick={(e) => e.stopPropagation()} className="anim-slide-up max-h-[85vh] w-full overflow-y-auto rounded-t-[28px] bg-white pt-2">
            <div className="mx-auto h-[5px] w-9 rounded-full bg-stone-300" aria-hidden="true" />
            <CartPanel restaurant={restaurant} cart={cart} onClose={() => setCartOpen(false)} />
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

function CartPanel({ restaurant, cart, onClose }: { restaurant: Restaurant; cart: Cart; onClose?: () => void }) {
  const missing = restaurant.minOrderAmount - cart.subtotal;
  const t = useT();
  return (
    <section className="rounded-[20px] bg-white p-4">
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
                  <button onClick={() => cart.change(l.key, -1)} aria-label={t("Retirer {name}", { name: describe(l) })} className="grid h-7 w-7 place-items-center rounded-full bg-stone-100 text-stone-700">
                    −
                  </button>
                  <span className="w-5 text-center">{l.quantity}</span>
                  <button onClick={() => cart.change(l.key, 1)} aria-label={t("Ajouter encore {name}", { name: describe(l) })} className="grid h-7 w-7 place-items-center rounded-full bg-stone-100 text-stone-700">
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
          <p className="mt-1 text-xs text-stone-500">{t("Frais de livraison calculés à l'étape suivante.")}</p>
          {missing > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              {t("Encore {amount} pour atteindre le minimum de {min}.", { amount: fcfa(missing), min: fcfa(restaurant.minOrderAmount) })}
            </p>
          )}
          {restaurant.availability.open && missing <= 0 ? (
            <Link href={`/r/${restaurant.slug}/commande`} className="mt-4 block rounded-2xl bg-emerald-600 px-4 py-3.5 text-center text-[17px] font-semibold text-white active:scale-[0.98]">
              {t("Commander")}
            </Link>
          ) : (
            <button disabled className="mt-4 w-full rounded-2xl bg-stone-200 px-4 py-3.5 text-[17px] font-semibold text-stone-500">
              {restaurant.availability.open ? t("Minimum {amount}", { amount: fcfa(restaurant.minOrderAmount) }) : t("Restaurant fermé")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
