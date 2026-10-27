"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ContactFields, { field } from "@/components/ContactFields";
import OrderCreated from "@/components/OrderCreated";
import { createOrder, fcfa, lineLabel, type CreatedOrder, type MenuItem, type Restaurant, type Zone } from "@/lib/api";
import { clearCart, lineKey, saveCart, useCart } from "@/lib/cart";
import { addressLine, customerFetch, savePlace, usePlace, useSession, type Address, type Profile } from "@/lib/customer";

type Props = { restaurant: Restaurant; zones: Zone[] };

type CartLine = { key: string; item: MenuItem; variantId?: string; addonIds: string[]; quantity: number };

function unitPrice(item: MenuItem, variantId: string | undefined, addonIds: string[]) {
  const base = item.variants.find((v) => v.id === variantId)?.price ?? item.price;
  return base + item.addons.filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
}

function describe(line: CartLine) {
  return lineLabel({
    name: line.item.name,
    variantName: line.item.variants.find((v) => v.id === line.variantId)?.name ?? null,
    addons: line.item.addons.filter((a) => line.addonIds.includes(a.id)),
  });
}

// Choix de la variante et des suppléments avant d'ajouter un plat au panier.
function Options({ item, onAdd, onClose }: { item: MenuItem; onAdd: (variantId: string | undefined, addonIds: string[]) => void; onClose: () => void }) {
  const [variantId, setVariantId] = useState(item.variants[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-stone-50 p-3 text-sm">
      {item.variants.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="font-medium">Choisir</legend>
          {item.variants.map((v) => (
            <label key={v.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <input type="radio" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                {v.name}
              </span>
              <span>{fcfa(v.price)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {item.addons.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="font-medium">Suppléments</legend>
          {item.addons.map((a) => (
            <label key={a.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={addonIds.includes(a.id)}
                  onChange={(e) => setAddonIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                />
                {a.name}
              </span>
              <span>+ {fcfa(a.price)}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onAdd(variantId, addonIds)}
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white"
        >
          Ajouter · {fcfa(unitPrice(item, variantId, addonIds))}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-2">
          Fermer
        </button>
      </div>
    </div>
  );
}

export default function OrderForm({ restaurant, zones }: Props) {
  // Le panier vit sur l'appareil : il survit au rechargement et à la fermeture de l'application.
  const stored = useCart();
  const cart = useMemo<CartLine[]>(() => {
    if (stored?.slug !== restaurant.slug) return [];
    return stored.lines.flatMap((l) => {
      const item = restaurant.menuItems.find((m) => m.id === l.menuItemId);
      return item ? [{ key: l.key, item, variantId: l.variantId, addonIds: l.addonIds, quantity: l.quantity }] : [];
    });
  }, [stored, restaurant]);
  const setCart = (update: (c: CartLine[]) => CartLine[]) => {
    const next = update(cart);
    saveCart(restaurant.slug, restaurant.name, next.map(({ item, ...l }) => ({ ...l, menuItemId: item.id })));
  };
  const otherCart = stored && stored.slug !== restaurant.slug && stored.lines.length > 0 ? stored : null;

  // Client connecté : nom, numéro et adresses enregistrées pré-remplis.
  const session = useSession();
  const place = usePlace();
  const [addresses, setAddresses] = useState<Address[]>([]);
  useEffect(() => {
    if (!session) return;
    customerFetch<Profile>("/me").then((p) => setAddresses(p.addresses), () => setAddresses([]));
  }, [session]);
  const [addressChoice, setAddressChoice] = useState<string | null>(null);
  const savedAddress = addresses.find((a) => a.id === (addressChoice ?? place?.addressId));
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  const zoneId = zoneChoice ?? savedAddress?.zone.id ?? place?.zoneId ?? "";
  const setZoneId = (id: string) => setZoneChoice(id);
  const [addressText, setAddressText] = useState<string | null>(null);
  const address = addressText ?? (savedAddress ? addressLine(savedAddress) : "");

  const [choosing, setChoosing] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [positionChoice, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const position =
    positionChoice ?? (savedAddress?.latitude != null && savedAddress.longitude != null ? { latitude: savedAddress.latitude, longitude: savedAddress.longitude } : null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const categories = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of restaurant.menuItems) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    return [...groups];
  }, [restaurant.menuItems]);

  const zone = zones.find((z) => z.id === zoneId);
  const subtotal = cart.reduce((s, l) => s + unitPrice(l.item, l.variantId, l.addonIds) * l.quantity, 0);
  const belowMinimum = subtotal < restaurant.minOrderAmount;
  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);
  const deliveryFee = fulfillment === "PICKUP" ? 0 : (zone?.deliveryFee ?? 0);
  const feeIsEstimate = fulfillment === "DELIVERY" && zone?.pricing === "DISTANCE";

  function pickAddress(a: Address) {
    setAddressChoice(a.id);
    setZoneChoice(a.zone.id);
    setAddressText(null);
    setPosition(null);
    savePlace({ addressId: a.id, zoneId: a.zone.id, label: a.label });
  }

  function add(item: MenuItem, variantId: string | undefined, addonIds: string[]) {
    if (otherCart && !window.confirm(`Votre panier contient des plats de ${otherCart.name}. Le vider pour commander ici ?`)) return;
    const key = lineKey(item.id, variantId, addonIds);
    setCart((c) => {
      const existing = c.find((l) => l.key === key);
      if (existing) return c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { key, item, variantId, addonIds, quantity: 1 }];
    });
    setChoosing(null);
  }

  function change(key: string, delta: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0));
  }

  const countFor = (id: string) => cart.filter((l) => l.item.id === id).reduce((s, l) => s + l.quantity, 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const order = await createOrder({
        restaurantSlug: restaurant.slug,
        zoneId,
        fulfillment,
        customerName: String(form.get("name") ?? ""),
        customerPhone: String(form.get("phone") ?? ""),
        address,
        note: String(form.get("note") ?? "") || undefined,
        paymentMethod,
        ...(position ?? {}),
        items: cart.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, variantId: l.variantId, addonIds: l.addonIds })),
      });
      setCreated(order);
      clearCart();
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) return <OrderCreated order={created} />;

  return (
    <form onSubmit={submit} className="space-y-6 pb-24">
      {otherCart && (
        <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">
          Votre panier contient déjà des plats de{" "}
          <Link href={`/r/${otherCart.slug}`} className="font-medium text-emerald-700 underline">
            {otherCart.name}
          </Link>
          . Un panier ne peut contenir qu&apos;un seul restaurant.
        </p>
      )}
      {categories.map(([category, items]) => (
        <section key={category}>
          <h2 className="mb-2 text-lg font-semibold">{category}</h2>
          <ul className="divide-y divide-stone-100 rounded-xl bg-white shadow-sm">
            {items.map((item) => {
              const hasOptions = item.variants.length > 0 || item.addons.length > 0;
              const simpleLine = cart.find((l) => l.key === `${item.id}|`);
              return (
                <li key={item.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    {item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- images fournies par les restaurants
                      <img src={item.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium">{item.name}</p>
                      {item.description && <p className="text-sm text-stone-600">{item.description}</p>}
                      <p className="text-sm text-stone-700">
                        {item.variants.length > 0 ? `dès ${fcfa(Math.min(...item.variants.map((v) => v.price)))}` : fcfa(item.price)}
                      </p>
                    </div>
                    <div className={`flex items-center gap-2 ${restaurant.availability.open ? "" : "hidden"}`}>
                      {!hasOptions && simpleLine && (
                        <>
                          <button
                            type="button"
                            onClick={() => change(simpleLine.key, -1)}
                            aria-label={`Retirer ${item.name}`}
                            className="h-9 w-9 rounded-full border border-stone-300 text-lg"
                          >
                            −
                          </button>
                          <span className="w-5 text-center">{simpleLine.quantity}</span>
                        </>
                      )}
                      {hasOptions && countFor(item.id) > 0 && <span className="text-sm text-stone-600">×{countFor(item.id)}</span>}
                      <button
                        type="button"
                        onClick={() => (hasOptions ? setChoosing(choosing === item.id ? null : item.id) : add(item, undefined, []))}
                        aria-label={`Ajouter ${item.name}`}
                        className="h-9 w-9 rounded-full bg-emerald-600 text-lg text-white"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {choosing === item.id && (
                    <Options item={item} onAdd={(v, a) => add(item, v, a)} onClose={() => setChoosing(null)} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {itemCount > 0 && (
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Votre panier</h2>
          <ul className="space-y-2 text-sm">
            {cart.map((l) => (
              <li key={l.key} className="flex items-center justify-between gap-2">
                <span className="flex-1">{describe(l)}</span>
                <span className="flex items-center gap-2">
                  <button type="button" onClick={() => change(l.key, -1)} aria-label={`Retirer ${describe(l)}`} className="h-7 w-7 rounded-full border border-stone-300">
                    −
                  </button>
                  {l.quantity}
                  <button type="button" onClick={() => change(l.key, 1)} aria-label={`Ajouter encore ${describe(l)}`} className="h-7 w-7 rounded-full border border-stone-300">
                    +
                  </button>
                </span>
                <span className="w-24 text-right">{fcfa(unitPrice(l.item, l.variantId, l.addonIds) * l.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-2 gap-2 text-sm">
            {(["DELIVERY", "PICKUP"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFulfillment(f)}
                className={`rounded-lg border px-3 py-2 ${fulfillment === f ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-300"}`}
              >
                {f === "DELIVERY" ? "Livraison" : "À emporter"}
              </button>
            ))}
          </div>

          {fulfillment === "DELIVERY" && addresses.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Livrer à</p>
              <div className="flex flex-wrap gap-2">
                {addresses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => pickAddress(a)}
                    className={`rounded-full border px-3 py-1.5 text-sm ${savedAddress?.id === a.id && addressText === null ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-300"}`}
                  >
                    {a.label} · {a.quarter}
                  </button>
                ))}
                <Link href="/app/adresses" className="rounded-full px-3 py-1.5 text-sm text-emerald-700 underline">
                  Gérer
                </Link>
              </div>
            </div>
          )}
          <ContactFields
            key={session?.phone ?? "invite"}
            defaultName={session?.name ?? undefined}
            defaultPhone={session?.phone ?? undefined}
            zones={zones}
            zoneId={zoneId}
            onZone={setZoneId}
            paymentMethod={paymentMethod}
            onPayment={setPaymentMethod}
            onPosition={fulfillment === "DELIVERY" ? setPosition : undefined}
          />
          {fulfillment === "DELIVERY" && (
            <textarea
              name="address"
              required
              minLength={5}
              rows={2}
              value={address}
              onChange={(e) => setAddressText(e.target.value)}
              placeholder="Adresse et repère (ex. Tokoin, derrière la pharmacie)"
              className={field}
            />
          )}
          <textarea name="note" rows={2} placeholder="Note pour le restaurant (facultatif)" className={field} />

          <dl className="space-y-1 border-t border-stone-100 pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Sous-total</dt>
              <dd>{fcfa(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Livraison</dt>
              <dd>{fulfillment === "PICKUP" ? "gratuite" : zoneId ? `${feeIsEstimate ? "env. " : ""}${fcfa(deliveryFee)}` : "–"}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd>{fcfa(subtotal + deliveryFee)}</dd>
            </div>
          </dl>
          {feeIsEstimate && <p className="text-xs text-stone-500">Dans cette zone, le tarif dépend de la distance et sera confirmé.</p>}
          {belowMinimum && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Commande minimum : {fcfa(restaurant.minOrderAmount)}. Ajoutez encore {fcfa(restaurant.minOrderAmount - subtotal)} de plats.
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </section>
      )}

      {itemCount > 0 && restaurant.availability.open && (
        <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-3">
          <button
            type="submit"
            disabled={submitting || belowMinimum}
            className="mx-auto block w-full max-w-2xl rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Envoi…" : belowMinimum ? `Minimum ${fcfa(restaurant.minOrderAmount)} · ${fcfa(subtotal)}` : `Commander (${itemCount}) · ${fcfa(subtotal + deliveryFee)}`}
          </button>
        </div>
      )}
    </form>
  );
}
