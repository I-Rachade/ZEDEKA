"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createOrder, fcfa, type CreatedOrder, type Restaurant, type Zone } from "@/lib/api";

type Props = { restaurant: Restaurant; zones: Zone[] };

export default function OrderForm({ restaurant, zones }: Props) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [zoneId, setZoneId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const categories = useMemo(() => {
    const groups = new Map<string, Restaurant["menuItems"]>();
    for (const item of restaurant.menuItems) {
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    }
    return [...groups];
  }, [restaurant.menuItems]);

  const subtotal = restaurant.menuItems.reduce((sum, i) => sum + i.price * (cart[i.id] ?? 0), 0);
  const itemCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const deliveryFee = zones.find((z) => z.id === zoneId)?.deliveryFee ?? 0;

  function change(id: string, delta: number) {
    setCart((c) => {
      const next = Math.max(0, (c[id] ?? 0) + delta);
      const copy = { ...c };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const order = await createOrder({
        restaurantSlug: restaurant.slug,
        zoneId,
        customerName: String(form.get("name") ?? ""),
        customerPhone: String(form.get("phone") ?? ""),
        address: String(form.get("address") ?? ""),
        note: String(form.get("note") ?? "") || undefined,
        paymentMethod,
        items: Object.entries(cart).map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
      });
      setCreated(order);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Commande {created.code} enregistrée</h2>
        <p className="text-stone-700">
          Total à payer : <strong>{fcfa(created.total)}</strong>. Envoyez-nous la commande sur WhatsApp pour que le
          livreur parte tout de suite.
        </p>
        <a
          href={created.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg bg-emerald-600 px-4 py-3 text-center font-semibold text-white"
        >
          Envoyer sur WhatsApp
        </a>
        <Link href={`/commande/${created.code}`} className="block text-center text-sm text-emerald-700 underline">
          Suivre ma commande
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6 pb-24">
      {categories.map(([category, items]) => (
        <section key={category}>
          <h2 className="mb-2 text-lg font-semibold">{category}</h2>
          <ul className="divide-y divide-stone-100 rounded-xl bg-white shadow-sm">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{item.name}</p>
                  {item.description && <p className="text-sm text-stone-600">{item.description}</p>}
                  <p className="text-sm text-stone-700">{fcfa(item.price)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {cart[item.id] ? (
                    <>
                      <button
                        type="button"
                        onClick={() => change(item.id, -1)}
                        aria-label={`Retirer ${item.name}`}
                        className="h-9 w-9 rounded-full border border-stone-300 text-lg"
                      >
                        −
                      </button>
                      <span className="w-5 text-center">{cart[item.id]}</span>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => change(item.id, 1)}
                    aria-label={`Ajouter ${item.name}`}
                    className="h-9 w-9 rounded-full bg-emerald-600 text-lg text-white"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {itemCount > 0 && (
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Livraison</h2>
          <input name="name" required minLength={2} placeholder="Votre nom" className="w-full rounded-lg border border-stone-300 p-3" />
          <input
            name="phone"
            required
            type="tel"
            inputMode="tel"
            pattern="\+?[0-9 ]{8,15}"
            placeholder="Téléphone (ex. 90 00 00 00)"
            className="w-full rounded-lg border border-stone-300 p-3"
          />
          <select
            required
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            className="w-full rounded-lg border border-stone-300 bg-white p-3"
          >
            <option value="">Choisir la zone de livraison</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} ({fcfa(z.deliveryFee)})
              </option>
            ))}
          </select>
          <textarea
            name="address"
            required
            minLength={5}
            rows={2}
            placeholder="Adresse et repère (ex. Tokoin, derrière la pharmacie)"
            className="w-full rounded-lg border border-stone-300 p-3"
          />
          <textarea name="note" rows={2} placeholder="Note pour le restaurant (facultatif)" className="w-full rounded-lg border border-stone-300 p-3" />
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Paiement</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={paymentMethod === "CASH"} onChange={() => setPaymentMethod("CASH")} />
              Espèces à la livraison
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={paymentMethod === "MOBILE_MONEY"}
                onChange={() => setPaymentMethod("MOBILE_MONEY")}
              />
              Mobile money à la livraison
            </label>
          </fieldset>
          <dl className="space-y-1 border-t border-stone-100 pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Sous-total</dt>
              <dd>{fcfa(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Livraison</dt>
              <dd>{zoneId ? fcfa(deliveryFee) : "–"}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd>{fcfa(subtotal + deliveryFee)}</dd>
            </div>
          </dl>
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </section>
      )}

      {itemCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-3">
          <button
            type="submit"
            disabled={submitting}
            className="mx-auto block w-full max-w-2xl rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Envoi…" : `Commander (${itemCount}) · ${fcfa(subtotal + deliveryFee)}`}
          </button>
        </div>
      )}
    </form>
  );
}
