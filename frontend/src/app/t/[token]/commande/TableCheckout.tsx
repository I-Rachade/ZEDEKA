"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { field } from "@/components/ContactFields";
import OrderCode from "@/components/OrderCode";
import TermsConsent from "@/components/legal/TermsConsent";
import { Icon } from "@/components/panel/icons";
import { createTableOrder, fcfa, type Restaurant } from "@/lib/api";
import { clearCart } from "@/lib/cart";
import { rememberContact, useContact } from "@/lib/customer";
import { rememberOrder, useHydrated } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { describe, unitPrice, useRestaurantCart } from "@/app/r/[slug]/useRestaurantCart";
import type { TableContext } from "@/app/r/[slug]/RestaurantView";

type Props = { restaurant: Restaurant; table: TableContext; mobileMoney: boolean };

// Caisse d'une commande sur place : prénom, remarque, paiement, et c'est parti. Ni adresse, ni livreur, ni frais ;
// le numéro de téléphone est facultatif. Le restaurant reçoit la commande avec le numéro de la table.
export default function TableCheckout({ restaurant, table, mobileMoney }: Props) {
  const cart = useRestaurantCart(restaurant);
  const contact = useContact();
  const hydrated = useHydrated();
  const t = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; total: number } | null>(null);

  // Prénom de la dernière commande, pour ne pas le retaper.
  useEffect(() => {
    if (contact) {
      setName((n) => n || contact.name);
      setPhone((p) => p || contact.phone);
    }
  }, [contact]);

  const back = (
    <Link href={`/t/${table.token}`} className="-ml-1.5 inline-flex items-center text-[17px] text-emerald-600 active:opacity-50">
      <Icon name="back" className="h-6 w-6" />
      {restaurant.name}
    </Link>
  );

  if (created)
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-[20px] bg-white p-5">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <Icon name="check" className="h-7 w-7" />
        </span>
        <h1 className="text-center text-xl font-semibold">{t("Commande envoyée au restaurant")}</h1>
        <p className="text-center text-stone-700">
          {t("Le restaurant vous apporte votre commande à la table {number}.", { number: table.number })} {t("Total à payer :")} <strong>{fcfa(created.total)}</strong>
        </p>
        <div className="rounded-xl bg-stone-50 p-3 text-center">
          <p className="text-xs uppercase tracking-wide text-stone-500">{t("Votre code de suivi")}</p>
          <OrderCode code={created.code} />
        </div>
        <Link href={`/commande/${created.code}`} className="block rounded-2xl bg-emerald-600 px-4 py-3.5 text-center text-[17px] font-semibold text-white">
          {t("Suivre ma commande")}
        </Link>
        <Link href={`/t/${table.token}`} className="block text-center text-sm text-emerald-700 underline">
          {t("Commander autre chose")}
        </Link>
      </div>
    );

  if (!hydrated) return <p className="text-stone-500">{t("Chargement…")}</p>;

  if (cart.count === 0)
    return (
      <div className="space-y-4">
        {back}
        <p className="rounded-[20px] bg-white p-6 text-center">{t("Votre panier est vide. Choisissez des plats sur la carte.")}</p>
      </div>
    );

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const order = await createTableOrder({
        acceptTerms: true,
        tableToken: table.token,
        restaurantSlug: restaurant.slug,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        note: note.trim() || undefined,
        paymentMethod,
        items: cart.lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, variantId: l.variantId, addonIds: l.addonIds })),
      });
      rememberContact({ name: name.trim(), phone: phone.trim() || contact?.phone || "" });
      rememberOrder("FOOD", order.code);
      clearCart();
      setCreated({ code: order.code, total: order.total });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const option = (on: boolean) => `flex-1 rounded-xl px-3 py-3 text-[15px] font-semibold ${on ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`;

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-5 pb-28">
      {back}
      <div className="flex items-center gap-3 rounded-[20px] bg-emerald-50 p-4 text-emerald-900">
        <span className="grid h-12 min-w-12 shrink-0 place-items-center rounded-xl bg-emerald-600 px-2 text-xl font-bold text-white">{table.number}</span>
        <p className="text-sm">
          <strong>{t("Table {number} · sur place", { number: table.number })}</strong>
          <br />
          {t("Commandez ici, le restaurant vous apporte votre commande à table.")}
        </p>
      </div>

      <section className="space-y-2 rounded-[20px] bg-white p-4">
        <h2 className="text-[17px] font-semibold">{t("Votre commande")}</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {cart.lines.map((l) => (
            <li key={l.key} className="flex justify-between gap-2 py-2">
              <span>
                {l.quantity} × {describe(l)}
              </span>
              <span className="shrink-0 font-medium">{fcfa(unitPrice(l.item, l.variantId, l.addonIds) * l.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-stone-100 pt-2 text-[17px] font-bold">
          <span>{t("Total")}</span>
          <span>{fcfa(cart.subtotal)}</span>
        </div>
      </section>

      <section className="space-y-3 rounded-[20px] bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("Votre prénom")}</span>
          <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            {t("Téléphone")} <span className="font-normal text-stone-500">({t("facultatif")})</span>
          </span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" pattern="\+?[0-9 ]{8,15}" className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            {t("Remarque pour la cuisine")} <span className="font-normal text-stone-500">({t("facultatif")})</span>
          </span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder={t("Ex. sans piment")} className={field} />
        </label>
      </section>

      <section className="space-y-2 rounded-[20px] bg-white p-4">
        <h2 className="text-[17px] font-semibold">{t("Paiement")}</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPaymentMethod("CASH")} aria-pressed={paymentMethod === "CASH"} className={option(paymentMethod === "CASH")}>
            {t("Espèces au restaurant")}
          </button>
          {mobileMoney && (
            <button type="button" onClick={() => setPaymentMethod("MOBILE_MONEY")} aria-pressed={paymentMethod === "MOBILE_MONEY"} className={option(paymentMethod === "MOBILE_MONEY")}>
              {t("Mobile money")}
            </button>
          )}
        </div>
        {paymentMethod === "CASH" && <p className="text-xs text-stone-500">{t("Vous payez au restaurant, quand on vous sert ou en partant.")}</p>}
      </section>

      <TermsConsent checked={accepted} onChange={setAccepted} />

      {!restaurant.availability.open && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{t("Fermé pour le moment.")}</strong> {restaurant.availability.reason}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 bg-white/95 p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <button
          disabled={submitting || !restaurant.availability.open}
          className="mx-auto block w-full max-w-xl rounded-2xl bg-emerald-600 px-4 py-3.5 text-[17px] font-semibold text-white disabled:bg-stone-300"
        >
          {submitting ? t("Envoi…") : t("Envoyer la commande · {total}", { total: fcfa(cart.subtotal) })}
        </button>
      </div>
    </form>
  );
}
