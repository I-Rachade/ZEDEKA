"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fcfa, type Restaurant } from "@/lib/api";
import { addressLine, customerFetch, locateMe, useSession, type Address, type Position, type Profile } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useI18n } from "@/lib/i18n/client";
import { WEEK_DAYS, whenLabel, type PlannedMeal } from "@/lib/plannedMeals";
import { describe, unitPrice, useRestaurantCart } from "../useRestaurantCart";

// Planifier le panier : une fois (jour et heure, jusqu'à 7 jours), ou formule cantine (jours de la semaine et
// heure fixes, 1 à 4 semaines). La commande part au restaurant 60 min avant chaque livraison, paiement à la livraison.
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export default function Planner({ restaurant }: { restaurant: Restaurant }) {
  const { t, locale } = useI18n();
  const hydrated = useHydrated();
  const session = useSession();
  const cart = useRestaurantCart(restaurant);
  const [kind, setKind] = useState<"ONCE" | "WEEKLY">("ONCE");
  const days7 = useMemo(() => Array.from({ length: 8 }, (_, i) => isoDay(new Date(Date.now() + i * 86_400_000))), []);
  const [day, setDay] = useState(days7[1]);
  const [time, setTime] = useState("12:30");
  const [weekDays, setWeekDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [weeks, setWeeks] = useState(1);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [here, setHere] = useState<Position | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PlannedMeal | null>(null);

  useEffect(() => {
    if (!session) return;
    setName((n) => n || session.name || "");
    customerFetch<Profile>("/me").then(
      (p) => {
        const usable = p.addresses.filter((a) => a.latitude !== null && a.longitude !== null);
        setAddresses(usable);
        setAddressId((id) => id ?? usable[0]?.id ?? null);
      },
      () => setAddresses([]),
    );
  }, [session]);

  if (!hydrated) return null;
  const back = `/r/${restaurant.slug}`;
  const shell = (body: React.ReactNode) => (
    <main className="mx-auto max-w-xl space-y-4 px-4 pb-24 pt-4">
      <Link href={back} className="text-sm text-emerald-700">
        ← {restaurant.name}
      </Link>
      <h1 className="text-[24px] font-bold leading-tight">{t("Planifier un repas")}</h1>
      {body}
    </main>
  );

  if (!session)
    return shell(
      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <p>{t("Connectez-vous pour planifier vos repas et les retrouver dans votre compte.")}</p>
        <Link href={`/app/connexion?suite=/r/${restaurant.slug}/planifier`} className="block rounded-2xl bg-emerald-600 px-4 py-3.5 text-center font-semibold text-white">
          {t("Se connecter")}
        </Link>
      </div>,
    );

  if (done)
    return shell(
      <div className="space-y-3 rounded-2xl bg-emerald-50 p-4 text-emerald-900">
        <p className="text-[17px] font-semibold">✓ {done.kind === "WEEKLY" ? t("Formule cantine enregistrée") : t("Repas planifié")}</p>
        {done.nextRunAt && <p>{t("Première livraison : {quand}", { quand: whenLabel(done.nextRunAt, locale) })}</p>}
        <p className="text-sm">{t("La commande part au restaurant une heure avant. Vous êtes prévenu à chaque envoi.")}</p>
        <Link href="/app/repas-planifies" className="block rounded-2xl bg-emerald-700 px-4 py-3 text-center font-semibold text-white">
          {t("Voir mes repas planifiés")}
        </Link>
      </div>,
    );

  if (cart.lines.length === 0)
    return shell(
      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <p>{t("Votre panier est vide : choisissez d'abord vos plats.")}</p>
        <Link href={back} className="block rounded-2xl bg-emerald-600 px-4 py-3.5 text-center font-semibold text-white">
          {t("Voir la carte")}
        </Link>
      </div>,
    );

  const saved = addresses.find((a) => a.id === addressId);
  const point = addressId === "here" ? here : saved && saved.latitude !== null && saved.longitude !== null ? { latitude: saved.latitude, longitude: saved.longitude } : null;
  const toggleDay = (d: number) => setWeekDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]));
  const perMeal = cart.subtotal;
  const meals = kind === "WEEKLY" ? weekDays.length * weeks : 1;

  async function submit() {
    if (!point) return setError(t("Choisissez où livrer"));
    if (kind === "WEEKLY" && weekDays.length === 0) return setError(t("Choisissez au moins un jour"));
    setBusy(true);
    setError(null);
    try {
      const created = await customerFetch<PlannedMeal>("/planned-meals", {
        method: "POST",
        body: {
          restaurantSlug: restaurant.slug,
          kind,
          ...(kind === "ONCE" ? { deliverAt: `${day}T${time}:00Z` } : { time, days: weekDays, weeks }),
          customerName: name.trim(),
          customerPhone: session!.phone,
          address: saved ? addressLine(saved) : t("Ma position"),
          latitude: point.latitude,
          longitude: point.longitude,
          note: note.trim() || undefined,
          items: cart.lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, variantId: l.variantId, addonIds: l.addonIds, choices: l.choices })),
        },
      });
      setDone(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) => `h-10 rounded-xl border px-3 text-[14px] font-semibold ${on ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-stone-200"}`;

  return shell(
    <>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Type")}>
        <button type="button" role="radio" aria-checked={kind === "ONCE"} onClick={() => setKind("ONCE")} className={`rounded-2xl border p-3 text-left ${kind === "ONCE" ? "border-emerald-700 bg-emerald-50" : "border-stone-200 bg-surface"}`}>
          <span className="block font-semibold">🕒 {t("Une fois")}</span>
          <span className="block text-[13px] text-stone-500">{t("Livré à l'heure choisie, jusqu'à 7 jours à l'avance.")}</span>
        </button>
        <button type="button" role="radio" aria-checked={kind === "WEEKLY"} onClick={() => setKind("WEEKLY")} className={`rounded-2xl border p-3 text-left ${kind === "WEEKLY" ? "border-emerald-700 bg-emerald-50" : "border-stone-200 bg-surface"}`}>
          <span className="block font-semibold">🍱 {t("Formule cantine")}</span>
          <span className="block text-[13px] text-stone-500">{t("Les mêmes plats chaque jour choisi, pendant 1 à 4 semaines.")}</span>
        </button>
      </div>

      <section className="space-y-3 rounded-2xl bg-surface p-4">
        {kind === "ONCE" ? (
          <label className="block text-sm font-medium">
            {t("Jour")}
            <select value={day} onChange={(e) => setDay(e.target.value)} className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5">
              {days7.map((d) => (
                <option key={d} value={d}>
                  {new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <div>
              <p className="text-sm font-medium">{t("Jours de livraison")}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {WEEK_DAYS.map((d) => (
                  <button key={d.day} type="button" aria-pressed={weekDays.includes(d.day)} onClick={() => toggleDay(d.day)} className={chip(weekDays.includes(d.day))}>
                    {t(d.short)}
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-sm font-medium">
              {t("Durée")}
              <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5">
                {[1, 2, 3, 4].map((w) => (
                  <option key={w} value={w}>
                    {w === 1 ? t("1 semaine") : t("{n} semaines", { n: w })}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="block text-sm font-medium">
          {t("Heure de livraison")}
          <input type="time" min="07:00" max="21:30" step={900} value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5" />
        </label>
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4">
        <p className="text-sm font-medium">{t("Où livrer ?")}</p>
        {addresses.map((a) => (
          <button key={a.id} type="button" aria-pressed={addressId === a.id} onClick={() => setAddressId(a.id)} className={`block w-full rounded-xl border px-3 py-2.5 text-left text-[14px] ${addressId === a.id ? "border-emerald-700 bg-emerald-50" : "border-stone-200"}`}>
            {addressLine(a)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={addressId === "here"}
          onClick={async () => {
            const p = await locateMe();
            if (!p) return setError(t("Position introuvable : autorisez la localisation, ou enregistrez une adresse."));
            setHere(p);
            setAddressId("here");
          }}
          className={`block w-full rounded-xl border px-3 py-2.5 text-left text-[14px] ${addressId === "here" ? "border-emerald-700 bg-emerald-50" : "border-stone-200"}`}
        >
          📍 {t("Ma position actuelle")}
        </button>
        <Link href="/app/adresses" className="block text-sm text-emerald-700">
          {t("Ajouter une adresse (bureau, école…)")}
        </Link>
        <label className="block text-sm font-medium">
          {t("Nom")}
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5" />
        </label>
        <label className="block text-sm font-medium">
          {t("Note pour le restaurant (facultatif)")}
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5" />
        </label>
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4 text-sm">
        <ul className="space-y-1">
          {cart.lines.map((l) => (
            <li key={l.key} className="flex justify-between gap-2">
              <span>
                {l.quantity} × {describe(l)}
              </span>
              <span className="shrink-0">{fcfa(unitPrice(l.item, l.variantId, l.addonIds) * l.quantity)}</span>
            </li>
          ))}
        </ul>
        <p className="hairline-t pt-2 font-semibold">
          {kind === "WEEKLY" ? t("{n} repas de {amount}, plus la livraison", { n: meals, amount: fcfa(perMeal) }) : t("{amount}, plus la livraison", { amount: fcfa(perMeal) })}
        </p>
        <p className="text-stone-500">{t("Paiement en espèces à chaque livraison. Les prix du jour s'appliquent.")}</p>
      </section>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
      <button type="button" disabled={busy || name.trim().length < 2} onClick={submit} className="w-full rounded-2xl bg-emerald-600 px-4 py-4 text-[17px] font-semibold text-white disabled:opacity-50">
        {busy ? t("Envoi…") : kind === "WEEKLY" ? t("Prendre la formule cantine") : t("Planifier ce repas")}
      </button>
    </>,
  );
}
