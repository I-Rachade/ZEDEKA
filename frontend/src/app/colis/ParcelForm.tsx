"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TopBar, card, input } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import OrderCreated from "@/components/OrderCreated";
import LocationLinkCard from "@/components/LocationLinkCard";
import MapPicker, { type Point } from "@/components/MapPicker";
import { distanceKm, km as kmLabel, rememberContact, useContact, useSession } from "@/lib/customer";
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
  // Facultative : le point de livraison est une position (placée sur la carte ou donnée par le destinataire).
  { key: "address", label: "Adresse et repère (facultatif)", ok: () => true },
] as const;
type FieldKey = (typeof TEXT_FIELDS)[number]["key"];

// Même calcul que l'API : tarif au km de la zone (minimum, maximum, arrondi à 50), ou tarif fixe.
function zoneFee(z: Zone | undefined, km: number | null) {
  if (!z) return 0;
  if (z.pricing === "FIXED" || km === null || !z.perKmFee) return z.deliveryFee;
  let fee = Math.ceil((km * z.perKmFee) / 50) * 50;
  if (z.minFee != null) fee = Math.max(fee, z.minFee);
  if (z.maxFee != null) fee = Math.min(fee, z.maxFee);
  return fee;
}

// Même arrondi que l'API : supplément au poids arrondi aux 50 FCFA supérieurs.
function extraFee(c: ParcelCategory | undefined, kg: number) {
  if (!c) return 0;
  return c.surcharge + Math.ceil((Math.max(0, kg) * c.perKgFee) / 50) * 50;
}

const chip = (on: boolean, missing = false) =>
  `rounded-[14px] px-3 py-2.5 text-left text-[15px] [overflow-wrap:anywhere] transition active:scale-[0.97] ${on ? "bg-emerald-600/10 font-semibold text-emerald-800 ring-2 ring-emerald-600" : missing ? "bg-red-50 ring-1 ring-red-400" : "bg-stone-100"}`;

function Legend({ children, missing }: { children: React.ReactNode; missing?: boolean }) {
  return (
    <legend className={`mb-2 text-[13px] uppercase tracking-wide ${missing ? "text-red-600" : "text-stone-500"}`}>
      {children}
      {missing && <span className="ml-1 normal-case tracking-normal">· à choisir</span>}
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

  // Le prix dépend de la distance : position du retrait, puis point de livraison placé par l'expéditeur
  // ou demandé au destinataire par un lien (la commande attend alors sa réponse).
  const [pickupPos, setPickupPos] = useState<Point | null>(null);
  const [dropPos, setDropPos] = useState<Point | null>(null);
  const [locating, setLocating] = useState<"idle" | "loading" | "error">("idle");
  const [askRecipient, setAskRecipient] = useState(false);
  const [picker, setPicker] = useState<"pickup" | "drop" | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const category = categories.find((c) => c.id === categoryId);
  const zone = zones.find((z) => z.id === value("zone"));
  const extra = extraFee(category, weight ?? 0);
  const km = pickupPos && dropPos && !askRecipient ? distanceKm(pickupPos, dropPos) : null;
  const fee = zoneFee(zone, km);
  const priceLater = askRecipient;

  function missingFor(s: number): string[] {
    if (s === 0) return [!categoryId && "category", weight === null && "weight", !size && "size"].filter((x): x is string => !!x);
    if (s === 1)
      return [
        ...TEXT_FIELDS.filter((f) => !f.ok(value(f.key))).map((f) => f.key),
        ...(pickupPos ? [] : ["pickupPos"]),
        ...(askRecipient || dropPos ? [] : ["dropPos"]),
      ];
    return [];
  }

  function locatePickup() {
    if (!("geolocation" in navigator)) return setLocating("error");
    setLocating("loading");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPickupPos({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setMissing((m) => m.filter((x) => x !== "pickupPos"));
        setLocating("idle");
      },
      () => setLocating("error"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
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
        pickupLatitude: pickupPos?.latitude,
        pickupLongitude: pickupPos?.longitude,
        address: value("address").trim(),
        askRecipientLocation: askRecipient,
        ...(dropPos && !askRecipient ? { latitude: dropPos.latitude, longitude: dropPos.longitude } : {}),
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
        <div className="space-y-4 p-4">
          {created.locationLink && <LocationLinkCard link={created.locationLink} recipientFirstName={value("recipientName").trim().split(/\s+/)[0]} />}
          <OrderCreated
            order={created}
            kind="PARCEL"
            priceNote={created.awaitingPosition ? "Le prix sera fixé dès que le destinataire aura partagé sa position, et un livreur partira alors." : undefined}
          />
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
  const areaField = (k: FieldKey, placeholder: string, labelText?: string) => {
    const f = TEXT_FIELDS.find((x) => x.key === k)!;
    const bad = missing.includes(k);
    return (
      <label className="block space-y-1">
        <span className={`text-sm ${bad ? "font-medium text-red-700" : "text-stone-600"}`}>{labelText ?? f.label}</span>
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
        : askRecipient
          ? "Envoyer la demande"
          : paymentMethod === "CASH"
          ? "Demander la livraison · espèces"
          : "Demander la livraison · mobile money";

  return (
    <div className="pb-40">
      <TopBar title="Envoyer un colis" onBack={() => (step === 0 ? router.push("/app") : show(step - 1))} action={<span className="pr-2 text-[15px] text-stone-500">{step + 1} sur 3</span>} />

      <div key={step} className="page-enter space-y-4 p-4">
        <div className="space-y-2">
          <div className="flex gap-1" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-emerald-600" : "bg-stone-200"}`} />
            ))}
          </div>
          <h2 className="pt-1 text-[28px] font-bold leading-tight">{step === 0 ? "Que voulez-vous envoyer ?" : step === 1 ? "D'où part le colis, et pour qui ?" : "Tout est bon ?"}</h2>
        </div>

        {step === 0 && (
          <div className={`${card} space-y-6 p-4`}>
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
                      <span className="block text-xs font-normal text-stone-500">
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
                    <span className="block text-xs font-normal text-stone-500">{s.hint}</span>
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
              <div id="colis-pickupPos" className="space-y-2">
                <p className={`text-sm ${missing.includes("pickupPos") ? "font-medium text-red-700" : "text-stone-600"}`}>Position du retrait (pour le prix)</p>
                {pickupPos ? (
                  <p className="flex items-center gap-2 rounded-xl bg-emerald-600/5 p-3 text-sm text-emerald-800">
                    <Icon name="check" className="h-4 w-4" /> Position enregistrée
                    <button type="button" onClick={() => setPicker("pickup")} className="ml-auto text-emerald-700 underline">
                      Modifier
                    </button>
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={locatePickup} disabled={locating === "loading"} className={chip(false, missing.includes("pickupPos"))}>
                      {locating === "loading" ? "Recherche…" : "Ma position actuelle"}
                      <span className="block text-xs font-normal text-stone-500">je suis au point de retrait</span>
                    </button>
                    <button type="button" onClick={() => setPicker("pickup")} className={chip(false, missing.includes("pickupPos"))}>
                      Choisir sur la carte
                    </button>
                  </div>
                )}
                {locating === "error" && <p className="text-sm text-red-700">Position indisponible. Autorisez la localisation, ou choisissez le point sur la carte.</p>}
              </div>
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
                      {z.name} ({z.pricing === "DISTANCE" ? "selon la distance" : fcfa(z.deliveryFee)})
                    </option>
                  ))}
                </select>
              </label>
              <fieldset id="colis-dropPos">
                <legend className={`mb-2 text-sm ${missing.includes("dropPos") ? "font-medium text-red-700" : "text-stone-600"}`}>Point de livraison (pour le prix)</legend>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAskRecipient(false);
                      setPicker("drop");
                    }}
                    aria-pressed={!askRecipient && !!dropPos}
                    className={chip(!askRecipient && !!dropPos, missing.includes("dropPos"))}
                  >
                    {!askRecipient && dropPos ? "Point placé" : "Je place le point"}
                    <span className="block text-xs font-normal text-stone-500">{!askRecipient && dropPos ? "toucher pour modifier" : "sur la carte"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAskRecipient(true);
                      setMissing((m) => m.filter((x) => x !== "dropPos"));
                    }}
                    aria-pressed={askRecipient}
                    className={chip(askRecipient, missing.includes("dropPos"))}
                  >
                    Demander sa position
                    <span className="block text-xs font-normal text-stone-500">lien envoyé par WhatsApp</span>
                  </button>
                </div>
              </fieldset>
              {askRecipient && (
                <p className="rounded-xl bg-emerald-600/5 p-3 text-sm text-stone-700">
                  Après la demande, vous enverrez un lien au destinataire. Dès qu&apos;il partage sa position, le prix est fixé et un livreur part. Sans réponse
                  en 24 h, la demande est annulée.
                </p>
              )}
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
                <button type="button" onClick={() => show(0)} className="text-sm text-emerald-600">
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
                      {[value("address").trim(), zone?.name].filter(Boolean).join(" · ")}
                    </span>
                    <span className="block text-emerald-700">{askRecipient ? "Sa position lui sera demandée par un lien" : `Point placé sur la carte${km !== null ? `, à ${kmLabel(km)} du retrait` : ""}`}</span>
                  </p>
                </div>
                <button type="button" onClick={() => show(1)} className="text-sm text-emerald-600">
                  Modifier
                </button>
              </div>
            </section>

            <section className={`${card} space-y-3 p-4`}>
              <h3 className="font-semibold">Paiement</h3>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPaymentMethod("CASH")} aria-pressed={paymentMethod === "CASH"} className={chip(paymentMethod === "CASH")}>
                  Espèces
                  <span className="block text-xs font-normal text-stone-500">au livreur</span>
                </button>
                <button type="button" onClick={() => setPaymentMethod("MOBILE_MONEY")} aria-pressed={paymentMethod === "MOBILE_MONEY"} className={chip(paymentMethod === "MOBILE_MONEY")}>
                  Mobile money
                  <span className="block text-xs font-normal text-stone-500">T-Money ou Flooz</span>
                </button>
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Instructions" rows={2} placeholder="Instructions pour le livreur (facultatif)" className={input} />
            </section>

            <dl className={`${card} space-y-1 p-4 text-sm`}>
              <div className="flex justify-between gap-2">
                <dt>Livraison ({zone?.name}{km !== null ? `, ${kmLabel(km)}` : ""})</dt>
                <dd className="shrink-0 tabular-nums">{priceLater ? "à la réponse" : fcfa(fee)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Supplément colis</dt>
                <dd className="tabular-nums">{fcfa(extra)}</dd>
              </div>
              <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{priceLater ? "à venir" : fcfa(fee + extra)}</dd>
              </div>
              {priceLater && <p className="pt-1 text-stone-500">Le prix de livraison sera calculé sur la distance dès que le destinataire aura partagé sa position.</p>}
            </dl>
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </>
        )}
      </div>

      {picker && (
        <MapPicker
          title={picker === "pickup" ? "Point de retrait" : "Point de livraison"}
          initial={picker === "pickup" ? pickupPos : (dropPos ?? pickupPos)}
          onClose={() => setPicker(null)}
          onPick={(p) => {
            if (picker === "pickup") setPickupPos(p);
            else setDropPos(p);
            setMissing((m) => m.filter((x) => x !== (picker === "pickup" ? "pickupPos" : "dropPos")));
            setPicker(null);
          }}
        />
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md px-3">
        <div className="glass space-y-2.5 rounded-[22px] p-3 shadow-[0_8px_30px_rgb(0_0_0/0.12)]">
          {missing.length > 0 ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {missing.length === 1 ? "Il manque une information, signalée en rouge." : `Il manque ${missing.length} informations, signalées en rouge.`}
            </p>
          ) : (
            <p className="flex justify-between px-1 text-[15px]">
              <span className="text-stone-600">{zone && !priceLater ? "Total" : category ? "Supplément colis" : "Prix"}</span>
              <span className="font-semibold tabular-nums">
                {zone && !priceLater ? fcfa(fee + extra) : category ? `+ ${fcfa(extra)}` : "selon le colis et la distance"}
              </span>
            </p>
          )}
          <button
            type="button"
            onClick={next}
            disabled={closed || submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-[17px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            {label}
            {step < 2 && !closed && <Icon name="chevron" className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
