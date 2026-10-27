"use client";

import { useEffect, useState } from "react";
import { field } from "@/components/ContactFields";
import TermsConsent from "@/components/legal/TermsConsent";
import { Icon } from "@/components/panel/icons";
import OrderCreated from "@/components/OrderCreated";
import { useSession } from "@/lib/customer";
import { createParcel, fcfa, type CreatedOrder, type ParcelCategory, type Zone } from "@/lib/api";

// Classes de poids proposées ; le tarif se calcule sur le poids retenu pour chaque classe.
const WEIGHTS = [
  { label: "Moins de 1 kg", kg: 0.5 },
  { label: "1 à 5 kg", kg: 3 },
  { label: "5 à 10 kg", kg: 8 },
  { label: "10 à 20 kg", kg: 15 },
  { label: "Plus de 20 kg", kg: 25 },
];

const SIZES = [
  { value: "SMALL", label: "Petit", hint: "enveloppe, boîte à chaussures" },
  { value: "MEDIUM", label: "Moyen", hint: "sac, carton de déménagement" },
  { value: "LARGE", label: "Grand", hint: "valise, gros carton" },
] as const;

type Size = (typeof SIZES)[number]["value"];
type Parcel = { categoryId: string; weight: number; size: Size };

// Même arrondi que l'API : supplément au poids arrondi aux 50 FCFA supérieurs.
function extraFee(c: ParcelCategory | undefined, kg: number) {
  if (!c) return 0;
  return c.surcharge + Math.ceil((Math.max(0, kg) * c.perKgFee) / 50) * 50;
}

const chip = (on: boolean) => `rounded-xl border px-3 py-2 text-left text-sm ${on ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-300 bg-white"}`;

// Étape 1 : type de colis, classe de poids et taille, dans une fenêtre.
function ParcelDialog({ categories, initial, onDone, onClose }: { categories: ParcelCategory[]; initial: Parcel | null; onDone: (p: Parcel) => void; onClose?: () => void }) {
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [weight, setWeight] = useState<number | null>(initial?.weight ?? null);
  const [size, setSize] = useState<Size | null>(initial?.size ?? null);
  const ready = categoryId && weight !== null && size;

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Votre colis" onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-lg space-y-5 overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Que voulez-vous envoyer ?</h2>
          {onClose && (
            <button onClick={onClose} aria-label="Fermer" className="grid h-9 w-9 place-items-center rounded-full bg-stone-100">
              <Icon name="close" className="h-5 w-5" />
            </button>
          )}
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">Type de colis</legend>
          <div className="grid grid-cols-2 gap-2">
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => setCategoryId(c.id)} aria-pressed={categoryId === c.id} className={chip(categoryId === c.id)}>
                {c.name}
                {(c.surcharge > 0 || c.perKgFee > 0) && (
                  <span className="block text-xs font-normal text-stone-600">
                    {c.surcharge > 0 && `+ ${fcfa(c.surcharge)}`}
                    {c.surcharge > 0 && c.perKgFee > 0 && " · "}
                    {c.perKgFee > 0 && `${fcfa(c.perKgFee)}/kg`}
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 font-semibold">Poids</legend>
          <div className="flex flex-wrap gap-2">
            {WEIGHTS.map((w) => (
              <button key={w.label} type="button" onClick={() => setWeight(w.kg)} aria-pressed={weight === w.kg} className={chip(weight === w.kg)}>
                {w.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 font-semibold">Taille</legend>
          <div className="grid grid-cols-3 gap-2">
            {SIZES.map((s) => (
              <button key={s.value} type="button" onClick={() => setSize(s.value)} aria-pressed={size === s.value} className={chip(size === s.value)}>
                {s.label}
                <span className="block text-xs font-normal text-stone-600">{s.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          disabled={!ready}
          onClick={() => ready && onDone({ categoryId, weight: weight!, size: size! })}
          className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {ready ? "Continuer" : "Choisissez le type, le poids et la taille"}
        </button>
      </div>
    </div>
  );
}

// Étape 2 : expéditeur et destinataire côte à côte, le colis rappelé en haut avec un crayon pour le modifier.
export default function ParcelForm({ zones, categories }: { zones: Zone[]; categories: ParcelCategory[] }) {
  const session = useSession();
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [editing, setEditing] = useState(true);
  const [zoneId, setZoneId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const category = categories.find((c) => c.id === parcel?.categoryId);
  const fee = zones.find((z) => z.id === zoneId)?.deliveryFee ?? 0;
  const extra = extraFee(category, parcel?.weight ?? 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!parcel) return setEditing(true);
    const f = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      setCreated(
        await createParcel({
          zoneId,
          customerName: String(f.get("name")),
          customerPhone: String(f.get("phone")),
          pickupAddress: String(f.get("pickupAddress")),
          address: String(f.get("address")),
          recipientName: String(f.get("recipientName")),
          recipientPhone: String(f.get("recipientPhone")),
          parcelCategoryId: parcel.categoryId,
          weightKg: parcel.weight,
          parcelSize: parcel.size,
          note: String(f.get("note") ?? "") || undefined,
          paymentMethod,
          acceptTerms: f.get("acceptTerms") === "on",
        }),
      );
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) return <OrderCreated order={created} kind="PARCEL" />;

  const summary = parcel && [category?.name, WEIGHTS.find((w) => w.kg === parcel.weight)?.label, SIZES.find((s) => s.value === parcel.size)?.label.toLowerCase()].join(" · ");

  return (
    <>
      {editing && (
        <ParcelDialog
          categories={categories}
          initial={parcel}
          onDone={(p) => {
            setParcel(p);
            setEditing(false);
          }}
          onClose={parcel ? () => setEditing(false) : undefined}
        />
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Votre colis</p>
            <p className="font-semibold">{summary ?? "À préciser"}</p>
          </div>
          <button type="button" onClick={() => setEditing(true)} aria-label="Modifier le colis" className="grid h-10 w-10 place-items-center rounded-full bg-stone-100">
            <Icon name="edit" className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Expéditeur</h2>
            <input name="name" aria-label="Nom de l'expéditeur" required minLength={2} placeholder="Votre nom" defaultValue={session?.name ?? undefined} className={field} />
            <input
              name="phone"
              aria-label="Téléphone de l'expéditeur"
              required
              type="tel"
              inputMode="tel"
              pattern="\+?[0-9 ]{8,15}"
              placeholder="Votre téléphone"
              defaultValue={session?.phone ?? undefined}
              className={field}
            />
            <textarea name="pickupAddress" aria-label="Adresse de retrait" required minLength={5} rows={2} placeholder="Adresse de retrait et repère" className={field} />
          </section>

          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Destinataire</h2>
            <input name="recipientName" aria-label="Nom du destinataire" required minLength={2} placeholder="Nom du destinataire" className={field} />
            <input
              name="recipientPhone"
              aria-label="Téléphone du destinataire"
              required
              type="tel"
              inputMode="tel"
              pattern="\+?[0-9 ]{8,15}"
              placeholder="Téléphone du destinataire"
              className={field}
            />
            <select required aria-label="Zone de livraison" value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={field}>
              <option value="">Zone de livraison</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({fcfa(z.deliveryFee)})
                </option>
              ))}
            </select>
            <textarea name="address" aria-label="Adresse de livraison" required minLength={5} rows={2} placeholder="Adresse de livraison et repère" className={field} />
          </section>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Paiement et instructions</h2>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPaymentMethod("CASH")} aria-pressed={paymentMethod === "CASH"} className={chip(paymentMethod === "CASH")}>
                Espèces
              </button>
              <button type="button" onClick={() => setPaymentMethod("MOBILE_MONEY")} aria-pressed={paymentMethod === "MOBILE_MONEY"} className={chip(paymentMethod === "MOBILE_MONEY")}>
                Mobile money
              </button>
            </div>
            <textarea name="note" aria-label="Instructions" rows={2} placeholder="Instructions pour le livreur (facultatif)" className={field} />
          </section>

          <section className="space-y-1 rounded-2xl bg-white p-4 text-sm shadow-sm">
            <div className="flex justify-between">
              <span>Livraison</span>
              <span>{zoneId ? fcfa(fee) : "choisir la zone"}</span>
            </div>
            <div className="flex justify-between">
              <span>Supplément colis</span>
              <span>{fcfa(extra)}</span>
            </div>
            <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-semibold">
              <span>Total</span>
              <span>{fcfa(fee + extra)}</span>
            </div>
            <TermsConsent className="mt-3" />
            {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
            <button disabled={submitting} className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60">
              {submitting ? "Envoi…" : "Demander la livraison"}
            </button>
          </section>
        </div>
      </form>
    </>
  );
}
