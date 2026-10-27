"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { fcfa, type MenuItem, type Restaurant } from "@/lib/api";
import { distanceKm, km, usePosition } from "@/lib/customer";
import ItemDialog from "./ItemDialog";
import { describe, fromPrice, unitPrice, useRestaurantCart } from "./useRestaurantCart";

type Cart = ReturnType<typeof useRestaurantCart>;

const slugOf = (c: string) => `cat-${c.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}`;

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
    const t = setTimeout(() => setAdded(null), 1800);
    return () => clearTimeout(t);
  }, [added]);

  function quickAdd(item: MenuItem) {
    if (item.variants.length || item.addons.length) setOpened(item);
    else if (cart.add(item, undefined, [])) setAdded(item.name);
  }

  return (
    <div className="pb-24 lg:pb-0">
      <nav aria-label="Fil d'Ariane" className="mb-3 text-sm text-stone-500">
        <Link href="/app" className="hover:underline">
          Accueil
        </Link>{" "}
        ›{" "}
        <Link href="/app/recherche" className="hover:underline">
          Restaurants
        </Link>{" "}
        › <span className="text-stone-700">{restaurant.name}</span>
      </nav>

      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-6">
        <div className="min-w-0">
          <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-100">
            <div className="flex items-start gap-3">
              {restaurant.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- logo fourni par le restaurant
                <img src={restaurant.logoUrl} alt="" className={`h-16 w-16 shrink-0 rounded-2xl object-cover ${open ? "" : "grayscale"}`} />
              ) : (
                <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-2xl font-bold text-emerald-700">{restaurant.name.charAt(0)}</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold">{restaurant.name}</h1>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${open ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}>{open ? "Ouvert" : "Fermé"}</span>
                </div>
                <p className="text-sm text-stone-600">
                  {restaurant.address}
                  {restaurant.zone ? ` · ${restaurant.zone.name.split(" (")[0]}` : ""}
                </p>
              </div>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              <li className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1">
                <Icon name="clock" className="h-4 w-4" /> {restaurant.deliveryTimeMin}–{restaurant.deliveryTimeMax} min
              </li>
              <li className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1">
                <Icon name="bag" className="h-4 w-4" /> {restaurant.minOrderAmount > 0 ? `Minimum ${fcfa(restaurant.minOrderAmount)}` : "Pas de minimum"}
              </li>
              {distance !== null && (
                <li className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1">
                  <Icon name="pin" className="h-4 w-4" /> {km(distance)}
                </li>
              )}
            </ul>
            {!open && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Fermé pour le moment.</strong> {restaurant.availability.reason} Vous pouvez consulter la carte, mais pas commander.
              </p>
            )}
          </header>

          {cart.otherCart && (
            <p className="mt-3 rounded-xl bg-stone-100 p-3 text-sm text-stone-700">
              Votre panier contient des plats de{" "}
              <Link href={`/r/${cart.otherCart.slug}`} className="font-medium text-emerald-700 underline">
                {cart.otherCart.name}
              </Link>
              . Un panier ne peut contenir qu&apos;un seul restaurant.
            </p>
          )}

          <div ref={tabs} role="tablist" aria-label="Catégories de la carte" className="sticky top-0 z-20 -mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-stone-200 bg-stone-50/95 px-4 py-2 backdrop-blur">
            {categories.map(([c]) => (
              <a
                key={c}
                href={`#${slugOf(c)}`}
                data-tab={c}
                role="tab"
                aria-selected={active === c}
                onClick={() => setActive(c)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${active === c ? "bg-emerald-600 text-white" : "text-stone-600 hover:bg-stone-200"}`}
              >
                {c}
              </a>
            ))}
          </div>

          {categories.map(([category, items]) => (
            <section key={category} id={slugOf(category)} data-category={category} className="scroll-mt-16 pt-4">
              <h2 className="mb-2 text-lg font-semibold">{category}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => {
                  const n = cart.countFor(item.id);
                  return (
                    <li key={item.id}>
                      <div className="flex h-full gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-100 sm:flex-col">
                        <button type="button" onClick={() => setOpened(item)} className="flex flex-1 gap-3 text-left sm:flex-col" aria-label={`Voir ${item.name}`}>
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- photos fournies par les restaurants
                            <img src={item.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover sm:aspect-[4/3] sm:h-auto sm:w-full" />
                          ) : (
                            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-400 sm:aspect-[4/3] sm:h-auto sm:w-full">
                              <Icon name="menu" className="h-8 w-8" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{item.name}</span>
                            {item.description && <span className="line-clamp-2 block text-sm text-stone-500">{item.description}</span>}
                          </span>
                        </button>
                        <div className="flex flex-col items-end justify-between gap-2 sm:flex-row sm:items-center">
                          <span className="text-sm font-semibold">{item.variants.length ? `dès ${fcfa(fromPrice(item))}` : fcfa(item.price)}</span>
                          {open && (
                            <button type="button" onClick={() => quickAdd(item)} aria-label={`Ajouter ${item.name}`} className="relative grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-lg text-white">
                              +
                              {n > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-stone-900 px-1 text-[11px]">{n}</span>}
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
        <p role="status" className="fixed inset-x-0 bottom-20 z-40 mx-auto w-max rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg lg:bottom-6">
          {added} ajouté au panier
        </p>
      )}

      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
          <button onClick={() => setCartOpen(true)} className="mx-auto flex w-full max-w-2xl items-center gap-3 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white">
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/20 px-1 text-sm">{cart.count}</span>
            <span className="flex-1 text-left">Voir le panier</span>
            <span>{fcfa(cart.subtotal)}</span>
          </button>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50 lg:hidden" onClick={() => setCartOpen(false)}>
          <div role="dialog" aria-label="Panier" onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white">
            <CartPanel restaurant={restaurant} cart={cart} onClose={() => setCartOpen(false)} />
          </div>
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
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-100">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Panier</h2>
        {onClose && (
          <button onClick={onClose} aria-label="Fermer le panier" className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100">
            <Icon name="close" className="h-5 w-5" />
          </button>
        )}
      </div>
      {cart.count === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500">Votre panier est vide. Touchez « + » sur un plat pour l&apos;ajouter.</p>
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
                  <button onClick={() => cart.change(l.key, -1)} aria-label={`Retirer ${describe(l)}`} className="grid h-7 w-7 place-items-center rounded-full border border-stone-300">
                    −
                  </button>
                  <span className="w-5 text-center">{l.quantity}</span>
                  <button onClick={() => cart.change(l.key, 1)} aria-label={`Ajouter encore ${describe(l)}`} className="grid h-7 w-7 place-items-center rounded-full border border-stone-300">
                    +
                  </button>
                  <button onClick={() => cart.remove(l.key)} aria-label={`Supprimer ${describe(l)}`} className="ml-auto text-stone-400 hover:text-red-600">
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-stone-100 pt-3 font-semibold">
            <span>Sous-total</span>
            <span>{fcfa(cart.subtotal)}</span>
          </div>
          <p className="mt-1 text-xs text-stone-500">Frais de livraison calculés à l&apos;étape suivante.</p>
          {missing > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Encore {fcfa(missing)} pour atteindre le minimum de {fcfa(restaurant.minOrderAmount)}.</p>}
          {restaurant.availability.open && missing <= 0 ? (
            <Link href={`/r/${restaurant.slug}/commande`} className="mt-3 block rounded-xl bg-emerald-600 px-4 py-3 text-center font-semibold text-white">
              Commander
            </Link>
          ) : (
            <button disabled className="mt-3 w-full rounded-xl bg-stone-300 px-4 py-3 font-semibold text-white">
              {restaurant.availability.open ? `Minimum ${fcfa(restaurant.minOrderAmount)}` : "Restaurant fermé"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
