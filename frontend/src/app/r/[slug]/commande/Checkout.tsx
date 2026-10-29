"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { field } from "@/components/ContactFields";
import OrderCreated from "@/components/OrderCreated";
import { Icon } from "@/components/panel/icons";
import { createOrder, fcfa, type CreatedOrder, type Restaurant, type Zone } from "@/lib/api";
import { clearCart } from "@/lib/cart";
import { addressLine, customerFetch, rememberContact, rememberPosition, savePlace, useContact, usePlace, useSession, type Address, type Profile } from "@/lib/customer";
import { useHydrated, useStored, writeStored } from "@/lib/device";
import { describe, unitPrice, useRestaurantCart } from "../useRestaurantCart";

const GUEST_KEY = "zedeka.guest";

type Props = { restaurant: Restaurant; zones: Zone[] };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// Plus petit billet courant qui couvre le total : on rappelle au client la monnaie à rendre, pour éviter l'attente à la porte.
function changeFor(total: number): { note: number; change: number } | null {
  const note = [1000, 2000, 5000, 10000].find((n) => n >= total);
  return note && note > total ? { note, change: note - total } : null;
}

const option = (on: boolean) => `rounded-xl border px-3 py-3 text-left ${on ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-300"}`;

// Caisse : sans session, le client choisit d'abord entre se connecter et commander sans compte.
// À gauche les informations de livraison, à droite le récapitulatif et le bouton de confirmation.
export default function Checkout({ restaurant, zones }: Props) {
  const hydrated = useHydrated();
  const session = useSession();
  const guest = useStored<boolean>(GUEST_KEY);
  const cart = useRestaurantCart(restaurant);
  const place = usePlace();
  const contact = useContact();
  // Zone et contact déjà connus : une ligne avec « Modifier » plutôt qu'un champ à remplir de nouveau.
  const [zoneOpen, setZoneOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const knownName = session?.name ?? contact?.name ?? "";
  const knownPhone = session?.phone ?? contact?.phone ?? "";

  const [addresses, setAddresses] = useState<Address[]>([]);
  useEffect(() => {
    if (!session) return;
    customerFetch<Profile>("/me").then((p) => setAddresses(p.addresses), () => setAddresses([]));
  }, [session]);
  const [addressChoice, setAddressChoice] = useState<string | null>(null);
  const savedAddress = addresses.find((a) => a.id === (addressChoice ?? place?.addressId));
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  const zoneId = zoneChoice ?? savedAddress?.zone.id ?? place?.zoneId ?? "";
  const [addressText, setAddressText] = useState<string | null>(null);
  const address = addressText ?? (savedAddress ? addressLine(savedAddress) : "");

  const [fulfillment, setFulfillment] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [positionChoice, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const position =
    positionChoice ?? (savedAddress?.latitude != null && savedAddress.longitude != null ? { latitude: savedAddress.latitude, longitude: savedAddress.longitude } : null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const zone = zones.find((z) => z.id === zoneId);
  const deliveryFee = fulfillment === "PICKUP" ? 0 : (zone?.deliveryFee ?? 0);
  const feeIsEstimate = fulfillment === "DELIVERY" && zone?.pricing === "DISTANCE";
  const belowMinimum = cart.subtotal < restaurant.minOrderAmount;
  const total = cart.subtotal + deliveryFee;
  const blocked = submitting || belowMinimum || !restaurant.availability.open;

  function pickAddress(a: Address) {
    setAddressChoice(a.id);
    setZoneChoice(a.zone.id);
    setAddressText(null);
    setPosition(null);
    savePlace({ addressId: a.id, zoneId: a.zone.id, label: a.label });
  }

  function locate() {
    if (!navigator.geolocation) return;
    setLocating("loading");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { latitude: p.coords.latitude, longitude: p.coords.longitude };
        setPosition(pos);
        rememberPosition(pos);
        setLocating("ok");
      },
      () => setLocating("error"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    const name = String(form.get("name") ?? "");
    const phone = String(form.get("phone") ?? "");
    try {
      const order = await createOrder({
        restaurantSlug: restaurant.slug,
        zoneId,
        fulfillment,
        customerName: name,
        customerPhone: phone,
        address: fulfillment === "DELIVERY" ? address : "",
        note: String(form.get("note") ?? "") || undefined,
        paymentMethod,
        ...(fulfillment === "DELIVERY" ? (position ?? {}) : {}),
        items: cart.lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, variantId: l.variantId, addonIds: l.addonIds })),
      });
      if (!session) rememberContact({ name: name.trim(), phone: phone.trim() });
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
  if (!hydrated) return <p className="text-stone-500">Chargement…</p>;

  const back = (
    <Link href={`/r/${restaurant.slug}`} className="text-sm text-emerald-700 underline">
      ← Retour à la carte de {restaurant.name}
    </Link>
  );

  if (cart.count === 0)
    return (
      <div className="space-y-4">
        {back}
        <p className="rounded-2xl bg-white p-6 text-center shadow-sm">Votre panier est vide. Choisissez des plats sur la carte.</p>
      </div>
    );

  if (!session && !guest) {
    const suite = encodeURIComponent(`/r/${restaurant.slug}/commande`);
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {back}
        <h1 className="text-2xl font-bold">Comment voulez-vous commander ?</h1>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href={`/app/connexion?suite=${suite}`} className="space-y-1 rounded-2xl border-2 border-emerald-600 bg-white p-4 shadow-sm">
            <p className="font-semibold">Se connecter</p>
            <p className="text-sm text-stone-600">Avec votre numéro. Vos adresses sont remplies et vos commandes gardées.</p>
          </Link>
          <button onClick={() => writeStored(GUEST_KEY, true)} className="space-y-1 rounded-2xl border border-stone-300 bg-white p-4 text-left shadow-sm">
            <p className="font-semibold">Continuer sans compte</p>
            <p className="text-sm text-stone-600">Vous suivez la commande avec son code et votre numéro.</p>
          </button>
        </div>
      </div>
    );
  }

  const confirmLabel = submitting
    ? "Envoi…"
    : !restaurant.availability.open
      ? "Restaurant fermé"
      : belowMinimum
        ? `Minimum ${fcfa(restaurant.minOrderAmount)}`
        : paymentMethod === "CASH"
          ? "Confirmer · payer à la livraison"
          : "Confirmer · payer par mobile money";
  const change = paymentMethod === "CASH" && zoneId ? changeFor(total) : null;

  return (
    <form id="checkout" onSubmit={submit} className="space-y-4 pb-28 lg:pb-0">
      {back}
      <h1 className="text-2xl font-bold">Valider la commande</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="Mode de retrait">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFulfillment("DELIVERY")} aria-pressed={fulfillment === "DELIVERY"} className={option(fulfillment === "DELIVERY")}>
                Livraison
                <span className="block text-xs font-normal text-stone-600">
                  {restaurant.deliveryTimeMin}–{restaurant.deliveryTimeMax} min
                </span>
              </button>
              <button type="button" onClick={() => setFulfillment("PICKUP")} aria-pressed={fulfillment === "PICKUP"} className={option(fulfillment === "PICKUP")}>
                À emporter
                <span className="block text-xs font-normal text-stone-600">{restaurant.address}</span>
              </button>
            </div>
          </Card>

          <Card title={fulfillment === "DELIVERY" ? "Adresse de livraison" : "Votre quartier"}>
            {fulfillment === "DELIVERY" && addresses.length > 0 && (
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
            )}
            {zone && !zoneOpen ? (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs text-stone-500">Zone</span>
                  <span className="block truncate font-medium">{zone.name}</span>
                </span>
                <button type="button" onClick={() => setZoneOpen(true)} className="shrink-0 text-sm text-emerald-700 underline">
                  Modifier
                </button>
              </div>
            ) : (
              <select required aria-label="Zone" value={zoneId} onChange={(e) => setZoneChoice(e.target.value)} className={field}>
                <option value="">Choisir la zone</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.pricing === "DISTANCE" ? `selon la distance, dès ${fcfa(z.deliveryFee)}` : fcfa(z.deliveryFee)})
                  </option>
                ))}
              </select>
            )}
            {fulfillment === "DELIVERY" && (
              <>
                <textarea
                  name="address"
                  aria-label="Adresse et repère"
                  required
                  minLength={5}
                  rows={2}
                  value={address}
                  onChange={(e) => setAddressText(e.target.value)}
                  placeholder="Adresse et repère (ex. Tokoin, derrière la pharmacie)"
                  className={field}
                />
                <button type="button" onClick={locate} className="text-left text-sm text-emerald-700 underline">
                  {locating === "loading"
                    ? "Localisation…"
                    : locating === "ok" || positionChoice
                      ? "Position enregistrée ✓"
                      : locating === "error"
                        ? "Position indisponible, réessayer"
                        : "Partager ma position (aide le livreur et calcule le tarif)"}
                </button>
              </>
            )}
          </Card>

          <Card title="Contact">
            {knownName && knownPhone && !contactOpen ? (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2.5">
                <input type="hidden" name="name" value={knownName} />
                <input type="hidden" name="phone" value={knownPhone} />
                <span className="min-w-0 truncate">
                  <span className="font-medium">{knownName}</span> · {knownPhone}
                </span>
                <button type="button" onClick={() => setContactOpen(true)} className="shrink-0 text-sm text-emerald-700 underline">
                  Modifier
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="name" aria-label="Votre nom" required minLength={2} placeholder="Votre nom" defaultValue={knownName || undefined} className={field} />
                <input
                  name="phone"
                  aria-label="Téléphone"
                  required
                  type="tel"
                  inputMode="tel"
                  pattern="\+?[0-9 ]{8,15}"
                  placeholder="Téléphone (ex. 90 00 00 00)"
                  defaultValue={knownPhone || undefined}
                  className={field}
                />
              </div>
            )}
            {!session && (
              <p className="text-xs text-stone-500">
                Sans compte.{" "}
                <button type="button" onClick={() => writeStored(GUEST_KEY, null)} className="text-emerald-700 underline">
                  Se connecter plutôt
                </button>
              </p>
            )}
            <textarea name="note" aria-label="Note pour le restaurant" rows={2} placeholder="Note pour le restaurant (facultatif)" className={field} />
          </Card>

          <Card title="Paiement">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPaymentMethod("CASH")} aria-pressed={paymentMethod === "CASH"} className={`${option(paymentMethod === "CASH")} flex items-center gap-3`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white">
                  <Icon name="wallet" className="h-5 w-5" />
                </span>
                <span>
                  Espèces
                  <span className="block text-xs font-normal text-stone-600">à la livraison</span>
                </span>
              </button>
              <button type="button" onClick={() => setPaymentMethod("MOBILE_MONEY")} aria-pressed={paymentMethod === "MOBILE_MONEY"} className={`${option(paymentMethod === "MOBILE_MONEY")} flex items-center gap-3`}>
                <span className="flex shrink-0 -space-x-2" aria-hidden="true">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-sun text-xs font-extrabold text-ink ring-2 ring-white">T</span>
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-700 text-xs font-extrabold text-white ring-2 ring-white">F</span>
                </span>
                <span>
                  Mobile money
                  <span className="block text-xs font-normal text-stone-600">T-Money ou Flooz</span>
                </span>
              </button>
            </div>
            {change && (
              <p className="rounded-lg bg-sun-soft p-3 text-sm text-amber-950">
                Si possible, préparez l&apos;appoint : avec un billet de <strong>{change.note.toLocaleString("fr-FR")}</strong>, le livreur doit vous rendre <strong>{fcfa(change.change)}</strong>.
              </p>
            )}
          </Card>
        </div>

        <aside className="space-y-3 rounded-2xl bg-white p-4 shadow-sm lg:sticky lg:top-4">
          <h2 className="font-semibold">Votre commande chez {restaurant.name}</h2>
          <ul className="space-y-2 text-sm">
            {cart.lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-2">
                <span>
                  <span className="font-medium">{l.quantity} ×</span> {describe(l)}
                </span>
                <span className="shrink-0">{fcfa(unitPrice(l.item, l.variantId, l.addonIds) * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <Link href={`/r/${restaurant.slug}`} className="block text-sm text-emerald-700 underline">
            Modifier le panier
          </Link>
          <dl className="space-y-1 border-t border-stone-100 pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Sous-total</dt>
              <dd>{fcfa(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Livraison</dt>
              <dd>{fulfillment === "PICKUP" ? "gratuite" : zoneId ? (deliveryFee === 0 ? "gratuite" : `${feeIsEstimate ? "env. " : ""}${fcfa(deliveryFee)}`) : "choisir la zone"}</dd>
            </div>
            <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{fcfa(total)}</dd>
            </div>
          </dl>
          {feeIsEstimate && <p className="text-xs text-stone-500">Dans cette zone, le tarif dépend de la distance et sera confirmé.</p>}
          {belowMinimum && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Commande minimum : {fcfa(restaurant.minOrderAmount)}. Ajoutez encore {fcfa(restaurant.minOrderAmount - cart.subtotal)} de plats.
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={blocked} className="hidden w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60 lg:block">
            {confirmLabel}
          </button>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
        <button type="submit" disabled={blocked} className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60">
          <span>{confirmLabel}</span>
          <span>{fcfa(total)}</span>
        </button>
      </div>
    </form>
  );
}
