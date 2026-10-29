"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TopBar, card, input } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import OrderCreated from "@/components/OrderCreated";
import { rememberContact, useContact, useSession } from "@/lib/customer";
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

const STEPS = ["Votre colis", "Retrait et livraison", "Vérifier"] as const;

// Champs texte de l'étape 2 et leur règle, dans l'ordre de l'écran.
const PHONE = /^\+?[0-9 ]{8,15}$/;
const TEXT_FIELDS = [
  { key: "name", label: "Votre nom", ok: (v: string) => v.trim().length >= 2 },
  { key: "phone", label: "Votre téléphone", ok: (v: string) => PHONE.test(v.trim()) },
  { key: "pickupAddress", label: "Adresse de retrait et repère", ok: (v: string) => v.trim().length >= 5 },
  { key: "recipientName", label: "Nom du destinataire", ok: (v: string) => v.trim().length >= 2 },
  { key: "recipientPhone", label: "Téléphone du destinataire", ok: (v: string) => PHONE.test(v.trim()) },
  { key: "zone", label: "Zone de livraison", ok: (v: string) => v !== "" },
  { key: "address", label: "Adresse de livraison et repère", ok: (v: string) => v.trim().length >= 5 },
] as const;
type FieldKey = (typeof TEXT_FIELDS)[number]["key"];

// Même arrondi que l'API : supplément au poids arrondi aux 50 FCFA supérieurs.
function extraFee(c: ParcelCategory | undefined, kg: number) {
  if (!c) return 0;
  return c.surcharge + Math.ceil((Math.max(0, kg) * c.perKgFee) / 50) * 50;
}

const chip = (on: boolean, missing = false) =>
  `rounded-xl border px-3 py-2.5 text-left text-sm [overflow-wrap:anywhere] transition ${on ? "border-emerald-600 bg-emerald-50 font-semibold" : missing ? "border-red-400 bg-red-50/40" : "border-stone-300 bg-white"}`;

function Legend({ children, missing }: { children: React.ReactNode; missing?: boolean }) {
  return (
    <legend className={`mb-2 font-semibold ${missing ? "text-red-700" : ""}`}>
      {children}
      {missing && <span className="ml-1 text-sm font-normal">· à choisir</span>}
    </legend>
  );
}

// Envoi d'un colis en trois étapes : quoi, d'où vers où, puis vérification.
// Le bouton du bas n'est jamais grisé : s'il manque quelque chose, il le signale et y conduit.
export default function ParcelForm({ zones, categories }: { zones: Zone[]; categories: ParcelCategory[] }) {
  const router = useRouter();
  const session = useSession();
  const contact = useContact();
  const [step, setStep] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [weight, setWeight] = useState<number | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  const [typed, setTyped] = useState<Partial<Record<FieldKey, string>>>({});
  const defaults: Partial<Record<FieldKey, string>> = { name: session?.name ?? contact?.name ?? "", phone: session?.phone ?? contact?.phone ?? "" };
  const value = (k: FieldKey) => typed[k] ?? defaults[k] ?? "";
  const set = (k: FieldKey, v: string) => {
    setTyped((t) => ({ ...t, [k]: v }));
    setMissing((m) => m.filter((x) => x !== k));
  };

  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const category = categories.find((c) => c.id === categoryId);
  const zone = zones.find((z) => z.id === value("zone"));
  const extra = extraFee(category, weight ?? 0);
  const fee = zone?.deliveryFee ?? 0;

  function missingFor(s: number): string[] {
    if (s === 0) return [!categoryId && "category", weight === null && "weight", !size && "size"].filter((x): x is string => !!x);
    if (s === 1) return TEXT_FIELDS.filter((f) => !f.ok(value(f.key))).map((f) => f.key);
    return [];
  }

  function show(s: number) {
    setStep(s);
    setMissing([]);
    setError(null);
    window.scrollTo({ top: 0 });
  }

  async function next() {
    const gaps = missingFor(step);
    if (gaps.length > 0) {
      setMissing(gaps);
      const el = document.getElementById(`colis-${gaps[0]}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
      return;
    }
    if (step < 2) return show(step + 1);

    setSubmitting(true);
    setError(null);
    try {
      const order = await createParcel({
        zoneId: value("zone"),
        customerName: value("name").trim(),
        customerPhone: value("phone").trim(),
        pickupAddress: value("pickupAddress").trim(),
        address: value("address").trim(),
        recipientName: value("recipientName").trim(),
        recipientPhone: value("recipientPhone").trim(),
        parcelCategoryId: categoryId,
        weightKg: weight!,
        parcelSize: size!,
        note: note.trim() || undefined,
        paymentMethod,
      });
      if (!session) rememberContact({ name: value("name").trim(), phone: value("phone").trim() });
      setCreated(order);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created)
    return (
      <>
        <TopBar title="Colis envoyé" back="/app" />
        <div className="p-4">
          <OrderCreated order={created} kind="PARCEL" />
        </div>
      </>
    );

  const closed = categories.length === 0;
  const textField = (k: FieldKey, extraProps: React.InputHTMLAttributes<HTMLInputElement> = {}) => {
    const f = TEXT_FIELDS.find((x) => x.key === k)!;
    const bad = missing.includes(k);
    return (
      <label className="block space-y-1">
        <span className={`text-sm ${bad ? "font-medium text-red-700" : "text-stone-600"}`}>{f.label}</span>
        <input
          id={`colis-${k}`}
          value={value(k)}
          onChange={(e) => set(k, e.target.value)}
          aria-invalid={bad || undefined}
          className={`${input} ${bad ? "border-red-400 bg-red-50/40" : ""}`}
          {...extraProps}
        />
      </label>
    );
  };
  const areaField = (k: FieldKey, placeholder: string) => {
    const f = TEXT_FIELDS.find((x) => x.key === k)!;
    const bad = missing.includes(k);
    return (
      <label className="block space-y-1">
        <span className={`text-sm ${bad ? "font-medium text-red-700" : "text-stone-600"}`}>{f.label}</span>
        <textarea
          id={`colis-${k}`}
          rows={2}
          value={value(k)}
          onChange={(e) => set(k, e.target.value)}
          placeholder={placeholder}
          aria-invalid={bad || undefined}
          className={`${input} ${bad ? "border-red-400 bg-red-50/40" : ""}`}
        />
      </label>
    );
  };

  const label = closed
    ? "Envoi de colis indisponible"
    : submitting
      ? "Envoi…"
      : step < 2
        ? "Continuer"
        : paymentMethod === "CASH"
          ? "Demander la livraison · espèces"
          : "Demander la livraison · mobile money";

  return (
    <div className="pb-40">
      <TopBar title="Envoyer un colis" onBack={() => (step === 0 ? router.push("/app") : show(step - 1))} action={<span className="pr-3 text-sm text-stone-500">{step + 1}/3</span>} />

      <div key={step} className="page-enter space-y-4 p-4">
        <div className="space-y-2">
          <div className="flex gap-1" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-sun" : "bg-stone-200"}`} />
            ))}
          </div>
          <h2 className="text-xl font-bold">{step === 0 ? "Que voulez-vous envoyer ?" : step === 1 ? "D'où part le colis, et pour qui ?" : "Tout est bon ?"}</h2>
        </div>

        {step === 0 && (
          <div className={`${card} space-y-5 p-4`}>
            <fieldset id="colis-category">
              <Legend missing={missing.includes("category")}>Type de colis</Legend>
              {closed && (
                <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  L&apos;envoi de colis n&apos;est pas encore ouvert : aucun type de colis n&apos;est disponible pour le moment.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(c.id);
                      setMissing((m) => m.filter((x) => x !== "category"));
                    }}
                    aria-pressed={categoryId === c.id}
                    className={chip(categoryId === c.id, missing.includes("category"))}
                  >
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
            <fieldset id="colis-weight">
              <Legend missing={missing.includes("weight")}>Poids</Legend>
              <div className="flex flex-wrap gap-2">
                {WEIGHTS.map((w) => (
                  <button
                    key={w.label}
                    type="button"
                    onClick={() => {
                      setWeight(w.kg);
                      setMissing((m) => m.filter((x) => x !== "weight"));
                    }}
                    aria-pressed={weight === w.kg}
                    className={chip(weight === w.kg, missing.includes("weight"))}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset id="colis-size">
              <Legend missing={missing.includes("size")}>Taille</Legend>
              <div className="grid grid-cols-3 gap-2">
                {SIZES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => {
                      setSize(s.value);
                      setMissing((m) => m.filter((x) => x !== "size"));
                    }}
                    aria-pressed={size === s.value}
                    className={chip(size === s.value, missing.includes("size"))}
                  >
                    {s.label}
                    <span className="block text-xs font-normal text-stone-600">{s.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {step === 1 && (
          <>
            <section className={`${card} space-y-3 p-4`}>
              <h3 className="flex items-center gap-2 font-semibold">
                <Icon name="box" className="h-5 w-5 text-emerald-600" /> Expéditeur
              </h3>
              {textField("name", { autoComplete: "name" })}
              {textField("phone", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "ex. 90 00 00 00" })}
              {areaField("pickupAddress", "ex. Bè Kpota, maison bleue")}
            </section>
            <section className={`${card} space-y-3 p-4`}>
              <h3 className="flex items-center gap-2 font-semibold">
                <Icon name="pin" className="h-5 w-5 text-emerald-600" /> Destinataire
              </h3>
              {textField("recipientName")}
              {textField("recipientPhone", { type: "tel", inputMode: "tel", placeholder: "ex. 91 00 00 00" })}
              <label className="block space-y-1">
                <span className={`text-sm ${missing.includes("zone") ? "font-medium text-red-700" : "text-stone-600"}`}>Zone de livraison</span>
                <select
                  id="colis-zone"
                  value={value("zone")}
                  onChange={(e) => set("zone", e.target.value)}
                  aria-invalid={missing.includes("zone") || undefined}
                  className={`${input} ${missing.includes("zone") ? "border-red-400 bg-red-50/40" : ""}`}
                >
                  <option value="">Choisir la zone</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} ({fcfa(z.deliveryFee)})
                    </option>
                  ))}
                </select>
              </label>
              {areaField("address", "ex. Adidogomé, près du rond-point")}
            </section>
          </>
        )}

        {step === 2 && (
          <>
            <section className={`${card} divide-y divide-stone-100`}>
              <div className="flex items-start gap-3 p-4">
                <Icon name="box" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">{category?.name}</p>
                  <p className="text-stone-600">
                    {WEIGHTS.find((w) => w.kg === weight)?.label} · {SIZES.find((s) => s.value === size)?.label.toLowerCase()}
                  </p>
                </div>
                <button type="button" onClick={() => show(0)} className="text-sm text-emerald-700 underline">
                  Modifier
                </button>
              </div>
              <div className="flex items-start gap-3 p-4">
                <Icon name="rider" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  <p>
                    <span className="text-stone-500">De </span>
                    <span className="font-semibold">{value("name")}</span> · {value("phone")}
                    <span className="block text-stone-600">{value("pickupAddress")}</span>
                  </p>
                  <p>
                    <span className="text-stone-500">Pour </span>
                    <span className="font-semibold">{value("recipientName")}</span> · {value("recipientPhone")}
                    <span className="block text-stone-600">
                      {value("address")} · {zone?.name}
                    </span>
                  </p>
                </div>
                <button type="button" onClick={() => show(1)} className="text-sm text-emerald-700 underline">
                  Modifier
                </button>
              </div>
            </section>

            <section className={`${card} space-y-3 p-4`}>
              <h3 className="font-semibold">Paiement</h3>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPaymentMethod("CASH")} aria-pressed={paymentMethod === "CASH"} className={chip(paymentMethod === "CASH")}>
                  Espèces
                  <span className="block text-xs font-normal text-stone-600">au livreur</span>
                </button>
                <button type="button" onClick={() => setPaymentMethod("MOBILE_MONEY")} aria-pressed={paymentMethod === "MOBILE_MONEY"} className={chip(paymentMethod === "MOBILE_MONEY")}>
                  Mobile money
                  <span className="block text-xs font-normal text-stone-600">T-Money ou Flooz</span>
                </button>
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Instructions" rows={2} placeholder="Instructions pour le livreur (facultatif)" className={input} />
            </section>

            <dl className={`${card} space-y-1 p-4 text-sm`}>
              <div className="flex justify-between">
                <dt>Livraison ({zone?.name})</dt>
                <dd className="tabular-nums">{fcfa(fee)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Supplément colis</dt>
                <dd className="tabular-nums">{fcfa(extra)}</dd>
              </div>
              <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{fcfa(fee + extra)}</dd>
              </div>
            </dl>
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md px-3">
        <div className="space-y-2 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-stone-200">
          {missing.length > 0 ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {missing.length === 1 ? "Il manque une information, signalée en rouge." : `Il manque ${missing.length} informations, signalées en rouge.`}
            </p>
          ) : (
            <p className="flex justify-between text-sm">
              <span className="text-stone-600">{zone ? "Total" : category ? "Supplément colis" : "Prix"}</span>
              <span className="font-semibold tabular-nums">{zone ? fcfa(fee + extra) : category ? `+ ${fcfa(extra)}` : "selon le colis et la zone"}</span>
            </p>
          )}
          <button
            type="button"
            onClick={next}
            disabled={closed || submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {label}
            {step < 2 && !closed && <Icon name="chevron" className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
