"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar, card, input } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import OrderCreated from "@/components/OrderCreated";
import LocationLinkCard from "@/components/LocationLinkCard";
import MapPicker, { type Point } from "@/components/MapPicker";
import PointPreview from "@/components/PointPreview";
import { useT } from "@/lib/i18n/client";
import RecipientRequest, { type SharedPosition } from "./RecipientRequest";
import { distanceKm, findRecipient, km as kmLabel, rememberContact, rememberRecipient, useContact, useSession, type KnownRecipient } from "@/lib/customer";
import {
  createParcel,
  fcfa,
  locateZone,
  parcelFee,
  resolveMapsLink,
  type CreatedOrder,
  type LocationRequest,
  type ParcelCategory,
  type ParcelPricing,
  type Zone,
} from "@/lib/api";

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

const STEPS = ["Votre colis", "Retrait et livraison", "Vérifier"] as const; // i18n-ignore

// Champs texte de l'étape 2 et leur règle, dans l'ordre de l'écran. Adresses : l'adresse écrite ou la position
// suffit, la règle est donc vérifiée avec la position (voir missingFor).
const PHONE = /^\+?[0-9 ]{8,15}$/;
const TEXT_FIELDS = [
  { key: "name", label: "Votre nom", ok: (v: string) => v.trim().length >= 2 },
  {
    key: "phone",
    label: "Votre téléphone",
    ok: (v: string) => PHONE.test(v.trim()),
  },
  {
    key: "pickupAddress",
    label: "Adresse de retrait et repère",
    ok: () => true,
  },
  {
    key: "recipientName",
    label: "Nom du destinataire",
    ok: (v: string) => v.trim().length >= 2,
  },
  {
    key: "recipientPhone",
    label: "Téléphone du destinataire",
    ok: (v: string) => PHONE.test(v.trim()),
  },
  { key: "address", label: "Adresse et repère", ok: () => true },
] as const;
type FieldKey = (typeof TEXT_FIELDS)[number]["key"];
const written = (v: string) => v.trim().length >= 3;

type DropMode = "map" | "link" | "ask";

// Même arrondi que l'API : supplément au poids arrondi aux 50 FCFA supérieurs.
function extraFee(c: ParcelCategory | undefined, kg: number) {
  if (!c) return 0;
  return c.surcharge + Math.ceil((Math.max(0, kg) * c.perKgFee) / 50) * 50;
}

const chip = (on: boolean, missing = false) =>
  `rounded-[14px] px-3 py-2.5 text-left text-[15px] [overflow-wrap:anywhere] transition active:scale-[0.97] ${on ? "bg-emerald-600/10 font-semibold text-emerald-800 ring-2 ring-emerald-600" : missing ? "bg-red-50 ring-1 ring-red-400" : "bg-stone-100"}`;

function Legend({ children, missing }: { children: React.ReactNode; missing?: boolean }) {
  const t = useT();
  return (
    <legend className={`mb-2 text-[13px] uppercase tracking-wide ${missing ? "text-red-600" : "text-stone-500"}`}>
      {children}
      {missing && <span className="ml-1 normal-case tracking-normal">· {t("à choisir")}</span>}
    </legend>
  );
}

// Envoi d'un colis en trois étapes : quoi, d'où vers où, puis vérification.
// Le bouton du bas n'est jamais grisé : s'il manque quelque chose, il le signale et y conduit.
export default function ParcelForm({
  zones,
  categories,
  pricing,
  mobileMoney,
}: {
  zones: Zone[];
  categories: ParcelCategory[];
  pricing: ParcelPricing;
  mobileMoney: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const session = useSession();
  const contact = useContact();
  const [step, setStep] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [weight, setWeight] = useState<number | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  const [typed, setTyped] = useState<Partial<Record<FieldKey, string>>>({});
  const defaults: Partial<Record<FieldKey, string>> = {
    name: session?.name ?? contact?.name ?? "",
    phone: session?.phone ?? contact?.phone ?? "",
  };
  const value = (k: FieldKey) => typed[k] ?? defaults[k] ?? "";
  const set = (k: FieldKey, v: string) => {
    setTyped((ty) => ({ ...ty, [k]: v }));
    setMissing((m) => m.filter((x) => x !== k));
  };

  // Le prix dépend de la distance entre la position du retrait et le point de livraison : placé sur la carte,
  // tiré d'un lien collé, ou partagé par le destinataire (lien à lui envoyer). La zone se déduit de ce point.
  const [pickupPos, setPickupPos] = useState<Point | null>(null);
  const [dropPos, setDropPos] = useState<Point | null>(null);
  const [dropFrom, setDropFrom] = useState<"map" | "link" | "recipient" | "known" | null>(null);
  const [mode, setMode] = useState<DropMode | null>(null);
  const [locating, setLocating] = useState<"idle" | "loading" | "error">("idle");
  const [picker, setPicker] = useState<"pickup" | "drop" | null>(null);
  const [link, setLink] = useState("");
  const [linkState, setLinkState] = useState<"idle" | "loading" | "error">("idle");
  const [request, setRequest] = useState<LocationRequest | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [zoneId, setZoneId] = useState<string | null | undefined>(undefined);
  const [known, setKnown] = useState<KnownRecipient | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  // Qui paie la livraison : l'expéditeur, ou le destinataire en espèces à la réception.
  const [payer, setPayer] = useState<"SENDER" | "RECIPIENT">("SENDER");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const category = categories.find((c) => c.id === categoryId);
  const extra = extraFee(category, weight ?? 0);
  const km = pickupPos && dropPos ? distanceKm(pickupPos, dropPos) : null;
  const fee = parcelFee(pricing, km);
  // Lien envoyé, pas encore de réponse : la commande attendra la position, et son prix.
  const priceLater = !dropPos && !!request && mode === "ask";
  // Sans les deux positions (adresse écrite) : tarif minimum, confirmé par Zedeka.
  const priceToConfirm = km === null && !priceLater;
  const zoneName = zoneId ? zones.find((z) => z.id === zoneId)?.name : null;

  // Zone déduite du point de livraison, jamais choisie par le client.
  useEffect(() => {
    if (!dropPos) return setZoneId(undefined);
    let current = true;
    locateZone(dropPos)
      .then((r) => current && setZoneId(r?.zoneId ?? null))
      .catch(() => current && setZoneId(null));
    return () => {
      current = false;
    };
  }, [dropPos]);

  // Destinataire déjà livré (même numéro) : son adresse et sa position peuvent être reprises.
  const recipientPhone = value("recipientPhone");
  useEffect(() => {
    setKnown(null);
    if (!PHONE.test(recipientPhone.trim())) return;
    let current = true;
    findRecipient(recipientPhone.trim()).then((r) => current && setKnown(r));
    return () => {
      current = false;
    };
  }, [recipientPhone]);

  function missingFor(s: number): string[] {
    if (s === 0) return [!categoryId && "category", weight === null && "weight", !size && "size"].filter((x): x is string => !!x);
    if (s === 1)
      return [
        ...TEXT_FIELDS.filter((f) => !f.ok(value(f.key))).map((f) => f.key),
        // Retrait comme livraison : l'adresse écrite ou la position, l'une des deux suffit.
        ...(pickupPos || written(value("pickupAddress")) ? [] : ["pickupAddress"]),
        ...(dropPos || request || written(value("address")) ? [] : ["address"]),
      ];
    return [];
  }

  function setDrop(p: Point, from: NonNullable<typeof dropFrom>) {
    setDropPos(p);
    setDropFrom(from);
    setMissing((m) => m.filter((x) => x !== "address"));
  }

  async function checkLink() {
    if (!link.trim()) return;
    setLinkState("loading");
    try {
      setDrop(await resolveMapsLink(link.trim()), "link");
      setLinkState("idle");
    } catch {
      setLinkState("error");
    }
  }

  function onShared(p: SharedPosition) {
    setDrop({ latitude: p.latitude, longitude: p.longitude }, "recipient");
    setAccuracy(p.accuracy ?? null);
    if (p.landmark && !value("address").trim()) set("address", p.landmark);
  }

  function useKnown() {
    if (!known) return;
    if (known.address && !value("address").trim()) set("address", known.address);
    if (known.latitude !== null && known.longitude !== null) {
      setMode(null);
      setDrop({ latitude: known.latitude, longitude: known.longitude }, "known");
    }
    setKnown(null);
  }

  function locatePickup() {
    if (!("geolocation" in navigator)) return setLocating("error");
    setLocating("loading");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPickupPos({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
        });
        setMissing((m) => m.filter((x) => x !== "pickupAddress"));
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
        customerName: value("name").trim(),
        customerPhone: value("phone").trim(),
        pickupAddress: value("pickupAddress").trim(),
        pickupLatitude: pickupPos?.latitude,
        pickupLongitude: pickupPos?.longitude,
        address: value("address").trim(),
        // Position partagée par le destinataire : l'API la lit sur la demande ; sinon le point placé ou collé.
        ...(request && (dropFrom === "recipient" || priceLater) ? { locationRequestKey: request.pollKey } : {}),
        ...(dropPos && dropFrom !== "recipient" ? { latitude: dropPos.latitude, longitude: dropPos.longitude } : {}),
        recipientName: value("recipientName").trim(),
        recipientPhone: value("recipientPhone").trim(),
        parcelCategoryId: categoryId,
        weightKg: weight!,
        parcelSize: size!,
        note: note.trim() || undefined,
        paymentMethod: payer === "RECIPIENT" ? "CASH" : paymentMethod,
        payer,
      });
      if (!session)
        rememberContact({
          name: value("name").trim(),
          phone: value("phone").trim(),
        });
      rememberRecipient(value("recipientPhone"), {
        name: value("recipientName").trim(),
        address: value("address").trim(),
        latitude: dropPos?.latitude ?? null,
        longitude: dropPos?.longitude ?? null,
      });
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
            priceNote={
              created.awaitingPosition
                ? t("Le prix sera fixé dès que le destinataire aura partagé sa position, et un livreur partira alors.")
                : created.priceToConfirm
                  ? t("Livraison au tarif minimum : Zedeka confirmera le prix d'après l'adresse.")
                  : undefined
            }
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
        <span className={`text-sm ${bad ? "font-medium text-red-700" : "text-stone-600"}`}>{t(f.label)}</span>
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
        <span className={`text-sm ${bad ? "font-medium text-red-700" : "text-stone-600"}`}>{labelText ?? t(f.label)}</span>
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

  const label = t(
    closed
      ? "Envoi de colis indisponible"
      : submitting
        ? "Envoi…"
        : step < 2
          ? "Continuer"
          : priceLater
            ? "Valider, en attente de sa position"
            : payer === "RECIPIENT"
              ? "Demander la livraison · payée par le destinataire"
              : mobileMoney && paymentMethod === "MOBILE_MONEY"
                ? "Demander la livraison · mobile money"
                : "Demander la livraison · espèces",
  );

  return (
    <div className="pb-40">
      <TopBar
        title="Envoyer un colis"
        onBack={() => (step === 0 ? router.push("/app") : show(step - 1))}
        action={<span className="pr-2 text-[15px] text-stone-500">{t("{n} sur 3", { n: step + 1 })}</span>}
      />

      <div key={step} className="page-enter space-y-4 p-4">
        <div className="space-y-2">
          <div className="flex gap-1" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-emerald-600" : "bg-stone-200"}`} />
            ))}
          </div>
          <h2 className="pt-1 text-[28px] font-bold leading-tight">
            {step === 0 ? t("Que voulez-vous envoyer ?") : step === 1 ? t("D'où part le colis, et pour qui ?") : t("Tout est bon ?")}
          </h2>
        </div>

        {step === 0 && (
          <div className={`${card} space-y-6 p-4`}>
            <fieldset id="colis-category">
              <Legend missing={missing.includes("category")}>{t("Type de colis")}</Legend>
              {closed && (
                <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  {t("L'envoi de colis n'est pas encore ouvert : aucun type de colis n'est disponible pour le moment.")}
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
              <Legend missing={missing.includes("weight")}>{t("Poids")}</Legend>
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
                    {t(w.label)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset id="colis-size">
              <Legend missing={missing.includes("size")}>{t("Taille")}</Legend>
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
                    {t(s.label)}
                    <span className="block text-xs font-normal text-stone-500">{t(s.hint)}</span>
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
                <Icon name="box" className="h-5 w-5 text-emerald-600" /> {t("Expéditeur")}
              </h3>
              {textField("name", { autoComplete: "name" })}
              {textField("phone", {
                type: "tel",
                inputMode: "tel",
                autoComplete: "tel",
                placeholder: t("ex. 90 00 00 00"),
              })}
              {areaField("pickupAddress", t("ex. Bè Kpota, maison bleue"), `${t("Adresse de retrait et repère")}${pickupPos ? ` ${t("(facultatif)")}` : ""}`)}
              <div id="colis-pickupPos" className="space-y-2">
                <p className={`text-sm ${missing.includes("pickupAddress") ? "font-medium text-red-700" : "text-stone-600"}`}>
                  {t("Position du retrait")} {written(value("pickupAddress")) ? t("(facultatif, pour le prix exact)") : t("(ou l'adresse ci-dessus)")}
                </p>
                {pickupPos ? (
                  <p className="flex items-center gap-2 rounded-xl bg-emerald-600/5 p-3 text-sm text-emerald-800">
                    <Icon name="check" className="h-4 w-4" /> {t("Position enregistrée")}
                    <button type="button" onClick={() => setPicker("pickup")} className="ml-auto text-emerald-700 underline">
                      {t("Modifier")}
                    </button>
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={locatePickup} disabled={locating === "loading"} className={chip(false, missing.includes("pickupAddress"))}>
                      {locating === "loading" ? t("Recherche…") : t("Ma position actuelle")}
                      <span className="block text-xs font-normal text-stone-500">{t("je suis au point de retrait")}</span>
                    </button>
                    <button type="button" onClick={() => setPicker("pickup")} className={chip(false, missing.includes("pickupAddress"))}>
                      {t("Choisir sur la carte")}
                    </button>
                  </div>
                )}
                {locating === "error" && (
                  <p className="text-sm text-red-700">{t("Position indisponible. Autorisez la localisation, ou choisissez le point sur la carte.")}</p>
                )}
              </div>
            </section>
            <section className={`${card} space-y-3 p-4`}>
              <h3 className="flex items-center gap-2 font-semibold">
                <Icon name="pin" className="h-5 w-5 text-emerald-600" /> {t("Destinataire")}
              </h3>
              {textField("recipientName")}
              {textField("recipientPhone", {
                type: "tel",
                inputMode: "tel",
                placeholder: t("ex. 91 00 00 00"),
              })}
              {known && (
                <div className="space-y-2 rounded-[14px] bg-emerald-600/5 p-3 text-sm">
                  <p className="text-stone-700">
                    {t("Déjà livré à ce numéro")}{known.name ? ` (${known.name})` : ""} :{" "}
                    <span className="font-medium">{known.address || (known.latitude !== null ? t("position enregistrée") : "")}</span>
                  </p>
                  <button type="button" onClick={useKnown} className="font-semibold text-emerald-700">
                    {t("Reprendre cette adresse")}
                  </button>
                </div>
              )}

              <fieldset id="colis-dropPos" className="min-w-0 space-y-2">
                <legend className={`mb-2 text-sm ${missing.includes("address") ? "font-medium text-red-700" : "text-stone-600"}`}>
                  {t("Position de livraison")} {written(value("address")) ? t("(facultatif, pour le prix exact)") : t("(ou l'adresse plus bas)")}
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["map", "Sur la carte", "je place le point"],
                      ["link", "Coller un lien", "Google Maps"],
                      ["ask", "Demander", "lien à lui envoyer"],
                    ] as const
                  ).map(([m, title, hint]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMode(m);
                        if (m === "map") setPicker("drop");
                      }}
                      aria-pressed={mode === m}
                      className={chip(mode === m, missing.includes("address"))}
                    >
                      {t(title)}
                      <span className="block text-xs font-normal text-stone-500">{t(hint)}</span>
                    </button>
                  ))}
                </div>

                {mode === "link" && (
                  <form
                    className="space-y-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      checkLink();
                    }}
                  >
                    <div className="flex gap-2">
                      <input
                        id="colis-link"
                        value={link}
                        onChange={(e) => {
                          setLink(e.target.value);
                          setLinkState("idle");
                        }}
                        inputMode="url"
                        placeholder={t("Collez le lien de localisation")}
                        aria-label={t("Lien de localisation")}
                        aria-invalid={linkState === "error" || undefined}
                        className={`${input} min-w-0 flex-1 ${linkState === "error" ? "border-red-400 bg-red-50/40" : ""}`}
                      />
                      <button
                        type="submit"
                        disabled={!link.trim() || linkState === "loading"}
                        className="shrink-0 rounded-xl bg-emerald-600 px-3 font-semibold text-white disabled:opacity-40"
                      >
                        {linkState === "loading" ? "…" : t("Vérifier")}
                      </button>
                    </div>
                    {linkState === "error" ? (
                      <p className="text-sm text-red-700">
                        {t("Ce lien ne contient pas de position. Dans Google Maps, touchez le point, puis « Partager », et copiez le lien.")}
                      </p>
                    ) : (
                      <p className="text-xs text-stone-500">{t("Lien Google Maps (même court, maps.app.goo.gl) ou coordonnées « 6.13, 1.22 ».")}</p>
                    )}
                  </form>
                )}

                {mode === "ask" && !(dropPos && dropFrom === "recipient") && (
                  <RecipientRequest
                    senderName={value("name")}
                    recipientName={value("recipientName")}
                    request={request}
                    onRequest={setRequest}
                    onShared={onShared}
                  />
                )}

                {dropPos && (
                  <PointPreview point={dropPos} pickup={pickupPos}>
                    <p className="font-medium text-emerald-800">
                      <Icon name="check" className="mr-1 inline h-4 w-4" />
                      {dropFrom === "recipient"
                        ? `${t("Position reçue du destinataire")}${accuracy ? `, ${t("à {n} m près", { n: Math.round(accuracy) })}` : ""}`
                        : dropFrom === "link"
                          ? t("Lien vérifié")
                          : dropFrom === "known"
                            ? t("Adresse précédente reprise")
                            : t("Point placé")}
                    </p>
                    <p className="text-stone-600">
                      {zoneId === undefined ? t("Zone…") : zoneName ? t("Zone : {name}", { name: zoneName }) : t("Zone attribuée par Zedeka")}
                      {km !== null && ` · ${t("{km} du retrait", { km: kmLabel(km) })}`}
                    </p>
                    {dropFrom !== "recipient" && (
                      <button type="button" onClick={() => setPicker("drop")} className="text-emerald-700 underline">
                        {t("Ajuster sur la carte")}
                      </button>
                    )}
                  </PointPreview>
                )}
              </fieldset>
              {areaField("address", t("ex. Adidogomé, près du rond-point"), `${t("Adresse et repère")}${dropPos || request ? ` ${t("(facultatif)")}` : ""}`)}
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
                    {t(WEIGHTS.find((w) => w.kg === weight)?.label ?? "")} · {t(SIZES.find((s) => s.value === size)?.label ?? "").toLowerCase()}
                  </p>
                </div>
                <button type="button" onClick={() => show(0)} className="text-sm text-emerald-600">
                  {t("Modifier")}
                </button>
              </div>
              <div className="flex items-start gap-3 p-4">
                <Icon name="rider" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  <p>
                    <span className="text-stone-500">{t("De")} </span>
                    <span className="font-semibold">{value("name")}</span> · {value("phone")}
                    <span className="block text-stone-600">{value("pickupAddress")}</span>
                  </p>
                  <p>
                    <span className="text-stone-500">{t("Pour")} </span>
                    <span className="font-semibold">{value("recipientName")}</span> · {value("recipientPhone")}
                    <span className="block text-stone-600">{[value("address").trim(), zoneName].filter(Boolean).join(" · ")}</span>
                    <span className="block text-emerald-700">
                      {priceLater
                        ? t("En attente de sa position (lien envoyé)")
                        : dropPos
                          ? `${t("Position de livraison connue")}${km !== null ? `, ${t("à {km} du retrait", { km: kmLabel(km) })}` : ""}`
                          : t("Adresse écrite, sans position")}
                    </span>
                  </p>
                </div>
                <button type="button" onClick={() => show(1)} className="text-sm text-emerald-600">
                  {t("Modifier")}
                </button>
              </div>
            </section>

            <section className={`${card} space-y-3 p-4`}>
              <h3 className="font-semibold">{t("Paiement")}</h3>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPayer("SENDER")} aria-pressed={payer === "SENDER"} className={chip(payer === "SENDER")}>
                  {t("Je paie")}
                  <span className="block text-xs font-normal text-stone-500">{mobileMoney ? t("espèces ou mobile money") : t("en espèces au livreur")}</span>
                </button>
                <button type="button" onClick={() => setPayer("RECIPIENT")} aria-pressed={payer === "RECIPIENT"} className={chip(payer === "RECIPIENT")}>
                  {t("Le destinataire paie")}
                  <span className="block text-xs font-normal text-stone-500">{t("en espèces à la réception")}</span>
                </button>
              </div>
              {payer === "SENDER" && mobileMoney && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("CASH")}
                    aria-pressed={paymentMethod === "CASH"}
                    className={chip(paymentMethod === "CASH")}
                  >
                    {t("Espèces")}
                    <span className="block text-xs font-normal text-stone-500">{t("au livreur")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("MOBILE_MONEY")}
                    aria-pressed={paymentMethod === "MOBILE_MONEY"}
                    className={chip(paymentMethod === "MOBILE_MONEY")}
                  >
                    {t("Mobile money")}
                    <span className="block text-xs font-normal text-stone-500">{t("T-Money ou Flooz")}</span>
                  </button>
                </div>
              )}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label={t("Instructions")}
                rows={2}
                placeholder={t("Instructions pour le livreur (facultatif)")}
                className={input}
              />
            </section>

            <dl className={`${card} space-y-1 p-4 text-sm`}>
              <div className="flex justify-between gap-2">
                <dt>{t("Livraison")}{km !== null ? ` (${kmLabel(km)})` : ""}</dt>
                <dd className="shrink-0 tabular-nums">{priceLater ? t("à la réponse") : priceToConfirm ? `${fcfa(fee)} ${t("min.")}` : fcfa(fee)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t("Supplément colis")}</dt>
                <dd className="tabular-nums">{fcfa(extra)}</dd>
              </div>
              <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-semibold">
                <dt>{t("Total")}</dt>
                <dd className="tabular-nums">{priceLater ? t("à venir") : fcfa(fee + extra)}</dd>
              </div>
              {priceLater && (
                <p className="pt-1 text-stone-500">{t("Le prix de livraison sera calculé sur la distance dès que le destinataire aura partagé sa position.")}</p>
              )}
              {priceToConfirm && (
                <p className="pt-1 text-stone-500">
                  {t("Sans les deux positions, la livraison est au tarif minimum : Zedeka confirmera le prix d'après l'adresse.")}
                </p>
              )}
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
            else setDrop(p, "map");
            setMissing((m) => m.filter((x) => x !== (picker === "pickup" ? "pickupAddress" : "address")));
            setPicker(null);
          }}
        />
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md px-3">
        <div className="glass space-y-2.5 rounded-[22px] p-3 shadow-[0_8px_30px_rgb(0_0_0/0.12)]">
          {missing.length > 0 ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {missing.length === 1 ? t("Il manque une information, signalée en rouge.") : t("Il manque {n} informations, signalées en rouge.", { n: missing.length })}
            </p>
          ) : (
            <p className="flex justify-between px-1 text-[15px]">
              <span className="text-stone-600">
                {km !== null ? `${t("Total")} (${kmLabel(km)})` : t(priceLater ? "Livraison" : step === 2 ? "Total, à confirmer" : category ? "Supplément colis" : "Prix")}
              </span>
              <span className="font-semibold tabular-nums">
                {km !== null
                  ? fcfa(fee + extra)
                  : priceLater
                    ? t("à la réponse")
                    : step === 2
                      ? `${fcfa(fee + extra)} ${t("min.")}`
                      : category
                        ? `+ ${fcfa(extra)}`
                        : t("selon le colis et la distance")}
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
