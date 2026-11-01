"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { field } from "@/components/ContactFields";
import OrderCreated from "@/components/OrderCreated";
import { Icon } from "@/components/panel/icons";
import MapPicker, { type Point } from "@/components/MapPicker";
import PointPreview from "@/components/PointPreview";
import RecipientRequest, { type SharedPosition } from "@/app/colis/RecipientRequest";
import TermsConsent, { CancellationNote, type Cancellation } from "@/components/legal/TermsConsent";
import { createOrder, fcfa, locateZone, parcelFee, type CreatedOrder, type LocationRequest, type ParcelPricing, type Restaurant, type Zone } from "@/lib/api";
import { clearCart } from "@/lib/cart";
import {
  addressLine,
  customerFetch,
  distanceKm,
  km as kmLabel,
  rememberContact,
  rememberPosition,
  savePlace,
  useContact,
  usePlace,
  useSession,
  type Address,
  type Profile,
} from "@/lib/customer";
import { useHydrated, useStored, writeStored } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { describe, unitPrice, useRestaurantCart } from "../useRestaurantCart";

const GUEST_KEY = "zedeka.guest";

// pricing : tarif au km des repas (réglages), entre le restaurant et le point de livraison.
// zones : nom de la zone du point, et centre de la zone du restaurant quand il n'a pas encore de position.
type Props = {
  restaurant: Restaurant;
  zones: Zone[];
  mobileMoney: boolean;
  pricing: ParcelPricing | null;
  cancellation: Cancellation | null;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useT();
  return (
    // Groupe iOS : petit titre gris au-dessus, contenu dans une carte blanche.
    <section>
      <h2 className="mb-1.5 px-4 text-[13px] font-normal uppercase tracking-wide text-stone-500">{t(title)}</h2>
      <div className="space-y-3 rounded-[20px] bg-white p-4">{children}</div>
    </section>
  );
}

// Plus petit billet courant qui couvre le total : on rappelle au client la monnaie à rendre, pour éviter l'attente à la porte.
function changeFor(total: number): { note: number; change: number } | null {
  const note = [1000, 2000, 5000, 10000].find((n) => n >= total);
  return note && note > total ? { note, change: note - total } : null;
}

// Point de livraison : comme pour les colis, une position et non une zone choisie dans une liste.
// Deux choix : ma position actuelle, ou pour quelqu'un d'autre (lui demander sa position par un lien, ou choisir
// le point sur la carte, où l'on peut chercher un lieu ou coller un lien Google Maps).
type DropMode = "gps" | "other";
type OtherWay = "ask" | "map";
type DropFrom = "gps" | "map" | "other" | "recipient" | "saved";
const DROP_MODES = [
  ["gps", "Ma position actuelle", "je suis sur place"],
  ["other", "Pour quelqu'un d'autre", "ou une autre adresse"],
] as const;
const OTHER_WAYS = [
  ["ask", "Lui demander sa position", "lien à lui envoyer"],
  ["map", "Choisir sur la carte", "chercher un lieu ou coller un lien"],
] as const;

// Commande en trois étapes, comme l'envoi de colis : livraison, coordonnées, puis vérification et paiement.
const STEPS = ["Livraison", "Vos coordonnées", "Vérifier et payer"] as const; // i18n-ignore
const STEP_TITLES = ["Où livrer votre commande ?", "Vos coordonnées", "Tout est bon ?"] as const;
const PHONE = /^\+?[0-9 ]{8,15}$/;

const option = (on: boolean) =>
  `rounded-[14px] px-3 py-3 text-left transition ${on ? "bg-emerald-600/10 font-semibold text-emerald-800 ring-2 ring-emerald-600" : "bg-stone-100"}`;

// Caisse : sans session, le client choisit d'abord entre se connecter et commander sans compte.
// À gauche les informations de livraison, à droite le récapitulatif et le bouton de confirmation.
export default function Checkout({ restaurant, zones, mobileMoney, pricing, cancellation }: Props) {
  const hydrated = useHydrated();
  const t = useT();
  const session = useSession();
  const guest = useStored<boolean>(GUEST_KEY);
  const cart = useRestaurantCart(restaurant);
  const place = usePlace();
  const contact = useContact();
  // Contact déjà connu : une ligne avec « Modifier » plutôt qu'un champ à remplir de nouveau.
  const [contactOpen, setContactOpen] = useState(false);
  const knownName = session?.name ?? contact?.name ?? "";
  const knownPhone = session?.phone ?? contact?.phone ?? "";
  const [nameTyped, setName] = useState<string | null>(null);
  const name = nameTyped ?? knownName;
  const [phoneTyped, setPhone] = useState<string | null>(null);
  const phone = phoneTyped ?? knownPhone;
  const [step, setStep] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);

  // Adresses enregistrées avec une position : un raccourci pour le point de livraison.
  const [addresses, setAddresses] = useState<Address[]>([]);
  useEffect(() => {
    if (!session) return;
    customerFetch<Profile>("/me").then(
      (p) => setAddresses(p.addresses.filter((a) => a.latitude !== null && a.longitude !== null)),
      () => setAddresses([]),
    );
  }, [session]);
  const [addressChoice, setAddressChoice] = useState<string | null>(null);
  const savedAddress = addresses.find((a) => a.id === (addressChoice ?? place?.addressId));

  const [fulfillment, setFulfillment] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");

  // Point de livraison : ma position actuelle, placé sur la carte, tiré d'un lien Google Maps collé, ou partagé par
  // la personne livrée (lien à lui envoyer). Le repère écrit est facultatif.
  const [dropChoice, setDropChoice] = useState<Point | null>(null);
  const [dropFrom, setDropFrom] = useState<DropFrom | null>(null);
  const [mode, setMode] = useState<DropMode | null>(null);
  const [locating, setLocating] = useState<"idle" | "loading" | "error">("idle");
  const [picker, setPicker] = useState(false);
  const [otherWay, setOtherWay] = useState<OtherWay | null>(null);
  const [request, setRequest] = useState<LocationRequest | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [landmarkTyped, setLandmark] = useState<string | null>(null);
  const savedPoint =
    savedAddress?.latitude != null && savedAddress.longitude != null ? { latitude: savedAddress.latitude, longitude: savedAddress.longitude } : null;
  const position = dropChoice ?? (dropFrom === null ? savedPoint : null);
  const from: DropFrom | null = dropChoice ? dropFrom : savedPoint && dropFrom === null ? "saved" : null;
  const landmark = landmarkTyped ?? (from === "saved" && savedAddress ? addressLine(savedAddress) : "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  // Zone déduite du point (affichée ; elle sert à répartir les livreurs, pas au prix).
  const [zoneId, setZoneId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!position) return setZoneId(undefined);
    let current = true;
    locateZone(position)
      .then((r) => current && setZoneId(r?.zoneId ?? null))
      .catch(() => current && setZoneId(null));
    return () => {
      current = false;
    };
  }, [position?.latitude, position?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  const delivery = fulfillment === "DELIVERY";
  // Même calcul que l'API : au km depuis le restaurant (restaurant sans position : centre de sa zone), sinon le minimum.
  const restaurantZone = zones.find((z) => z.id === restaurant.zone?.id);
  const restaurantPoint =
    restaurant.latitude !== null && restaurant.longitude !== null ? { latitude: restaurant.latitude, longitude: restaurant.longitude } : null;
  const priceFrom = restaurantPoint ?? { latitude: restaurantZone?.latitude ?? null, longitude: restaurantZone?.longitude ?? null };
  const km = position ? distanceKm(position, priceFrom) : null;
  const zone = zones.find((z) => z.id === (zoneId ?? restaurant.zone?.id));
  const deliveryFee = !delivery || !pricing ? 0 : parcelFee(pricing, km);
  const feeKnown = !delivery || !!position;
  const belowMinimum = cart.subtotal < restaurant.minOrderAmount;
  const total = cart.subtotal + (feeKnown ? deliveryFee : 0);
  const noPoint = delivery && !position;
  const blocked = submitting || belowMinimum || !restaurant.availability.open || noPoint;

  function setDrop(p: Point, f: DropFrom) {
    setMissing((m) => m.filter((x) => x !== "point"));
    setDropChoice(p);
    setDropFrom(f);
    rememberPosition(p);
  }

  function pickAddress(a: Address) {
    setAddressChoice(a.id);
    setDropChoice(null);
    setDropFrom(null);
    setMode(null);
    setOtherWay(null);
    setLandmark(null);
    savePlace({ addressId: a.id, zoneId: a.zone.id, label: a.label });
  }

  function locate() {
    if (!("geolocation" in navigator)) return setLocating("error");
    setLocating("loading");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setDrop({ latitude: p.coords.latitude, longitude: p.coords.longitude }, "gps");
        setAccuracy(p.coords.accuracy ?? null);
        setLocating("idle");
      },
      () => setLocating("error"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function chooseMode(m: DropMode) {
    setMode(m);
    if (m === "gps") return locate();
    // Pour quelqu'un d'autre : ma position ne compte plus tant que le nouveau point n'est pas choisi.
    if (dropFrom === "gps" || dropFrom === null) {
      setDropChoice(null);
      setDropFrom("other");
    }
  }

  function chooseOther(w: OtherWay) {
    setOtherWay(w);
    if (w === "map") setPicker(true);
  }

  function onShared(p: SharedPosition) {
    setDrop({ latitude: p.latitude, longitude: p.longitude }, "recipient");
    setAccuracy(p.accuracy ?? null);
    if (p.landmark && !landmark.trim()) setLandmark(p.landmark);
  }

  function missingFor(st: number): string[] {
    if (st === 0) return noPoint ? ["point"] : [];
    if (st === 1) return [name.trim().length < 2 && "name", !PHONE.test(phone.trim()) && "phone"].filter((x): x is string => !!x);
    return [];
  }

  function show(st: number) {
    setStep(st);
    setMissing([]);
    setError(null);
    window.scrollTo({ top: 0 });
  }

  // « Continuer » n'est jamais grisé : il signale ce qui manque, en rouge, et y conduit.
  function next() {
    const gaps = missingFor(step);
    if (gaps.length > 0) {
      setMissing(gaps);
      if (gaps.includes("name") || gaps.includes("phone")) setContactOpen(true);
      document.getElementById(`checkout-${gaps[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    show(step + 1);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (step < 2) return next();
    setSubmitting(true);
    setError(null);
    try {
      const order = await createOrder({
        acceptTerms: true,
        restaurantSlug: restaurant.slug,
        fulfillment,
        customerName: name,
        customerPhone: phone,
        address: delivery ? landmark.trim() : "",
        note: String(form.get("note") ?? "") || undefined,
        paymentMethod,
        // Position partagée par la personne livrée : l'API la lit sur la demande ; sinon le point lui-même.
        ...(delivery && from === "recipient" && request ? { locationRequestKey: request.pollKey } : delivery && position ? position : {}),
        items: cart.lines.map((l) => ({
          menuItemId: l.item.id,
          quantity: l.quantity,
          variantId: l.variantId,
          addonIds: l.addonIds,
        })),
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
  if (!hydrated) return <p className="text-stone-500">{t("Chargement…")}</p>;

  const back = (
    <Link href={`/r/${restaurant.slug}`} className="-ml-1.5 inline-flex items-center text-[17px] text-emerald-600 active:opacity-50">
      <Icon name="back" className="h-6 w-6" />
      {restaurant.name}
    </Link>
  );

  if (cart.count === 0)
    return (
      <div className="space-y-4">
        {back}
        <p className="rounded-[20px] bg-white p-6 text-center">{t("Votre panier est vide. Choisissez des plats sur la carte.")}</p>
      </div>
    );

  if (!session && !guest) {
    const suite = encodeURIComponent(`/r/${restaurant.slug}/commande`);
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {back}
        <h1 className="text-[34px] font-bold leading-tight">{t("Comment voulez-vous commander ?")}</h1>
        {/* Liste iOS : deux lignes avec icône et chevron. */}
        <div className="ios-list overflow-hidden rounded-[20px] bg-white">
          <Link href={`/app/connexion?suite=${suite}`} className="flex items-center gap-3.5 p-4 active:bg-stone-100">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-emerald-600 text-white">
              <Icon name="user" className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-[17px] font-semibold">{t("Se connecter")}</span>
              <span className="block text-[13px] text-stone-500">{t("Avec votre numéro. Vos adresses sont remplies et vos commandes gardées.")}</span>
            </span>
            <Icon name="chevron" className="h-4 w-4 shrink-0 text-stone-300" />
          </Link>
          <button onClick={() => writeStored(GUEST_KEY, true)} className="flex w-full items-center gap-3.5 p-4 text-left active:bg-stone-100">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-stone-400 text-white">
              <Icon name="bag" className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-[17px] font-semibold">{t("Continuer sans compte")}</span>
              <span className="block text-[13px] text-stone-500">{t("Vous suivez la commande avec son code et votre numéro.")}</span>
            </span>
            <Icon name="chevron" className="h-4 w-4 shrink-0 text-stone-300" />
          </button>
        </div>
      </div>
    );
  }

  const confirmLabel = submitting
    ? t("Envoi…")
    : !restaurant.availability.open
      ? t("Restaurant fermé")
      : belowMinimum
        ? t("Minimum {amount}", { amount: fcfa(restaurant.minOrderAmount) })
        : noPoint
          ? t("Indiquez le point de livraison")
          : paymentMethod === "CASH"
            ? t("Confirmer · payer à la livraison")
            : t("Confirmer · payer par mobile money");
  const change = paymentMethod === "CASH" && feeKnown ? changeFor(total) : null;
  const missingNote =
    missing.length > 0 ? (
      <p role="alert" className="text-sm font-medium text-red-700">
        {missing.includes("point")
          ? t("Indiquez le point de livraison : votre position, ou pour quelqu'un d'autre.")
          : missing.length === 1
            ? t("Il manque une information, signalée en rouge.")
            : t("Il manque {n} informations, signalées en rouge.", {
                n: missing.length,
              })}
      </p>
    ) : null;

  return (
    <form id="checkout" onSubmit={submit} noValidate className="space-y-5 pb-36 lg:pb-0">
      {step === 0 ? (
        back
      ) : (
        <button type="button" onClick={() => show(step - 1)} className="-ml-1.5 inline-flex items-center text-[17px] text-emerald-600 active:opacity-50">
          <Icon name="back" className="h-6 w-6" />
          {t(STEPS[step - 1])}
        </button>
      )}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {STEPS.map((st, i) => (
              <span key={st} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-emerald-600" : "bg-stone-200"}`} />
            ))}
          </div>
          <span className="text-[15px] text-stone-500">{t("{n} sur 3", { n: step + 1 })}</span>
        </div>
        <h1 className="text-[30px] font-bold leading-tight">{t(STEP_TITLES[step])}</h1>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <div className={step === 0 ? "space-y-6" : "hidden"}>
            <Card title="Mode de retrait">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFulfillment("DELIVERY")}
                  aria-pressed={fulfillment === "DELIVERY"}
                  className={option(fulfillment === "DELIVERY")}
                >
                  {t("Livraison")}
                  <span className="block text-xs font-normal text-stone-600">
                    {restaurant.deliveryTimeMin}–{restaurant.deliveryTimeMax} min
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setFulfillment("PICKUP")}
                  aria-pressed={fulfillment === "PICKUP"}
                  className={option(fulfillment === "PICKUP")}
                >
                  {t("À emporter")}
                  <span className="block text-xs font-normal text-stone-600">{restaurant.address}</span>
                </button>
              </div>
            </Card>
          </div>

          <div className={step === 1 ? "" : "hidden"}>
            <Card title="Contact">
              {knownName && knownPhone && !contactOpen ? (
                <div className="flex items-center justify-between gap-3">
                  <input type="hidden" name="name" value={knownName} />
                  <input type="hidden" name="phone" value={knownPhone} />
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{knownName}</span> · {knownPhone}
                  </span>
                  <button type="button" onClick={() => setContactOpen(true)} className="shrink-0 text-sm text-emerald-600">
                    {t("Modifier")}
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    id="checkout-name"
                    name="name"
                    aria-label={t("Votre nom")}
                    aria-invalid={missing.includes("name") || undefined}
                    placeholder={t("Votre nom")}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setMissing((m) => m.filter((x) => x !== "name"));
                    }}
                    className={`${field} ${missing.includes("name") ? "ring-1 ring-red-400" : ""}`}
                  />
                  <input
                    id="checkout-phone"
                    name="phone"
                    aria-label={t("Téléphone")}
                    aria-invalid={missing.includes("phone") || undefined}
                    type="tel"
                    inputMode="tel"
                    placeholder={t("Téléphone (ex. 90 00 00 00)")}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setMissing((m) => m.filter((x) => x !== "phone"));
                    }}
                    className={`${field} ${missing.includes("phone") ? "ring-1 ring-red-400" : ""}`}
                  />
                </div>
              )}
              {!session && (
                <p className="text-xs text-stone-500">
                  {t("Sans compte.")}{" "}
                  <button type="button" onClick={() => writeStored(GUEST_KEY, null)} className="text-emerald-600">
                    {t("Se connecter plutôt")}
                  </button>
                </p>
              )}
              <textarea
                name="note"
                aria-label={t("Note pour le restaurant")}
                rows={2}
                placeholder={t("Note pour le restaurant (facultatif)")}
                className={field}
              />
            </Card>
          </div>

          <div className={step === 0 ? "" : "hidden"}>
            {delivery && (
              <Card title="Adresse de livraison">
                {addresses.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {addresses.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => pickAddress(a)}
                        className={`rounded-full border px-3 py-1.5 text-sm ${from === "saved" && savedAddress?.id === a.id ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-300"}`}
                      >
                        {t(a.label)} · {a.quarter}
                      </button>
                    ))}
                    <Link href="/app/adresses" className="rounded-full px-3 py-1.5 text-sm text-emerald-600">
                      {t("Gérer")}
                    </Link>
                  </div>
                )}
                <div
                  id="checkout-point"
                  className={`grid grid-cols-2 gap-2 rounded-[16px] ${missing.includes("point") ? "ring-2 ring-red-400 ring-offset-2" : ""}`}
                >
                  {DROP_MODES.map(([m, title, hint]) => (
                    <button key={m} type="button" onClick={() => chooseMode(m)} aria-pressed={mode === m} className={option(mode === m)}>
                      {m === "gps" && locating === "loading" ? t("Recherche…") : t(title)}
                      <span className="block text-xs font-normal text-stone-600">{t(hint)}</span>
                    </button>
                  ))}
                </div>
                {mode === "gps" && locating === "error" && (
                  <p className="text-sm text-red-700">{t("Position indisponible. Autorisez la localisation, ou choisissez le point sur la carte.")}</p>
                )}

                {mode === "other" && (
                  <div className="grid grid-cols-2 gap-2">
                    {OTHER_WAYS.map(([w, title, hint]) => (
                      <button key={w} type="button" onClick={() => chooseOther(w)} aria-pressed={otherWay === w} className={option(otherWay === w)}>
                        {t(title)}
                        <span className="block text-xs font-normal text-stone-600">{t(hint)}</span>
                      </button>
                    ))}
                  </div>
                )}

                {mode === "other" && otherWay === "ask" && from !== "recipient" && (
                  <div className="space-y-2">
                    {/* Le nom de l'expéditeur figure dans le message du lien : demandé ici s'il n'est pas déjà connu. */}
                    {!knownName && (
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        aria-label={t("Votre nom (il apparaît dans le message)")}
                        placeholder={t("Votre nom (il apparaît dans le message)")}
                        className={field}
                      />
                    )}
                    <input
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      aria-label={t("Prénom de la personne livrée (facultatif)")}
                      placeholder={t("Prénom de la personne livrée (facultatif)")}
                      className={field}
                    />
                    <RecipientRequest
                      kind="FOOD"
                      senderName={name}
                      recipientName={recipientName}
                      request={request}
                      onRequest={setRequest}
                      onShared={onShared}
                    />
                  </div>
                )}

                {position && (
                  <PointPreview point={position} pickup={restaurantPoint}>
                    <p className="font-medium text-emerald-800">
                      <Icon name="check" className="mr-1 inline h-4 w-4" />
                      {from === "recipient"
                        ? `${t("Position reçue de la personne livrée")}${accuracy ? `, ${t("à {n} m près", { n: Math.round(accuracy) })}` : ""}`
                        : from === "gps"
                          ? `${t("Ma position actuelle")}${accuracy ? `, ${t("à {n} m près", { n: Math.round(accuracy) })}` : ""}`
                          : from === "saved"
                            ? t("Adresse enregistrée")
                            : t("Point placé")}
                    </p>
                    <p className="text-stone-600">
                      {[
                        zoneId === undefined ? t("Zone…") : zone && zoneId ? t("Zone : {name}", { name: zone.name }) : null,
                        km !== null ? t("{km} du restaurant", { km: kmLabel(km) }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {/* Le prix de la livraison dès que le point est connu, sans attendre la dernière étape. */}
                    <p className="font-semibold text-stone-900">{t("Livraison : {fee}", { fee: deliveryFee === 0 ? t("gratuite") : fcfa(deliveryFee) })}</p>
                    {from !== "recipient" && (
                      <button type="button" onClick={() => setPicker(true)} className="text-emerald-700 underline">
                        {t("Ajuster sur la carte")}
                      </button>
                    )}
                  </PointPreview>
                )}

                <textarea
                  name="address"
                  aria-label={t("Repère pour le livreur (facultatif)")}
                  rows={2}
                  maxLength={300}
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  placeholder={t("Repère pour le livreur (facultatif), ex. portail vert, derrière la pharmacie")}
                  className={field}
                />
              </Card>
            )}
          </div>

          <div className={step === 2 ? "space-y-6" : "hidden"}>
            {/* Rappel des deux premières étapes, chacune avec « Modifier ». */}
            <section className="ios-list overflow-hidden rounded-[20px] bg-white">
              <div className="flex items-start gap-3 p-4">
                <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">{delivery ? t("Livraison") : t("À emporter")}</p>
                  <p className="text-stone-600">
                    {!delivery
                      ? restaurant.address
                      : [
                          from === "recipient" ? t("Position reçue de la personne livrée") : from === "gps" ? t("Ma position actuelle") : from === "saved" ? t("Adresse enregistrée") : t("Point placé"),
                          km !== null ? t("{km} du restaurant", { km: kmLabel(km) }) : null,
                          landmark.trim() || null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </p>
                  {delivery && <p className="font-semibold text-stone-900">{t("Livraison : {fee}", { fee: deliveryFee === 0 ? t("gratuite") : fcfa(deliveryFee) })}</p>}
                </div>
                <button type="button" onClick={() => show(0)} className="shrink-0 text-sm text-emerald-600">
                  {t("Modifier")}
                </button>
              </div>
              <div className="flex items-start gap-3 p-4">
                <Icon name="user" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">{name}</span> · {phone}
                </p>
                <button type="button" onClick={() => show(1)} className="shrink-0 text-sm text-emerald-600">
                  {t("Modifier")}
                </button>
              </div>
            </section>
            <Card title="Paiement">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("CASH")}
                  aria-pressed={paymentMethod === "CASH"}
                  className={`${option(paymentMethod === "CASH")} flex items-center gap-3`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-emerald-600 text-white">
                    <Icon name="wallet" className="h-5 w-5" />
                  </span>
                  <span>
                    {t("Espèces")}
                    <span className="block text-xs font-normal text-stone-600">{t("à la livraison")}</span>
                  </span>
                </button>
                {mobileMoney && (
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("MOBILE_MONEY")}
                    aria-pressed={paymentMethod === "MOBILE_MONEY"}
                    className={`${option(paymentMethod === "MOBILE_MONEY")} flex items-center gap-3`}
                  >
                    <span className="flex shrink-0 -space-x-2" aria-hidden="true">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-sun text-xs font-extrabold text-ink ring-2 ring-white">T</span>
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-700 text-xs font-extrabold text-white ring-2 ring-white">F</span>
                    </span>
                    <span>
                      {t("Mobile money")}
                      <span className="block text-xs font-normal text-stone-600">{t("T-Money ou Flooz")}</span>
                    </span>
                  </button>
                )}
              </div>
              {change && (
                <p className="rounded-[14px] bg-sun-soft p-3 text-[13px] text-amber-950">
                  {t("Si possible, préparez l'appoint : avec un billet de {note}, le livreur doit vous rendre {change}.", {
                    note: change.note.toLocaleString("fr-FR"),
                    change: fcfa(change.change),
                  })}
                </p>
              )}
            </Card>
          </div>
        </div>

        <aside className={`space-y-3 rounded-[20px] bg-white p-4 lg:sticky lg:top-20 ${step === 2 ? "" : "hidden lg:block"}`}>
          <h2 className="text-[17px] font-semibold">{t("Votre commande")}</h2>
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
          <Link href={`/r/${restaurant.slug}`} className="block text-sm text-emerald-600">
            {t("Modifier le panier")}
          </Link>
          <dl className="hairline-t space-y-1.5 pt-3 text-[15px]">
            <div className="flex justify-between">
              <dt>{t("Sous-total")}</dt>
              <dd>{fcfa(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>
                {t("Livraison")}
                {delivery && km !== null ? ` (${kmLabel(km)})` : ""}
              </dt>
              <dd>{!delivery ? t("gratuite") : feeKnown ? (deliveryFee === 0 ? t("gratuite") : fcfa(deliveryFee)) : t("selon la distance")}</dd>
            </div>
            <div className="hairline-t flex justify-between pt-2.5 text-[17px] font-semibold">
              <dt>{t("Total")}</dt>
              <dd>{fcfa(total)}</dd>
            </div>
          </dl>
          {noPoint && (
            <p className="text-xs text-stone-500">{t("Indiquez le point de livraison : le prix se calcule sur la distance depuis le restaurant.")}</p>
          )}
          {belowMinimum && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {t("Commande minimum : {min}. Ajoutez encore {amount} de plats.", {
                min: fcfa(restaurant.minOrderAmount),
                amount: fcfa(restaurant.minOrderAmount - cart.subtotal),
              })}
            </p>
          )}
          {/* Seulement à la dernière étape : une case obligatoire cachée bloquerait le formulaire aux étapes précédentes. */}
          {step === 2 && (
            <TermsConsent>
              {/* Frais d'annulation annoncés avant la commande, pas découverts après. */}
              {cancellation && <CancellationNote {...cancellation} />}{" "}
              <Link href="/remboursement" target="_blank" className="underline">
                {t("Annulation et remboursement")}
              </Link>
            </TermsConsent>
          )}
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {missingNote}
          {/* Des clés distinctes : sans elles React réutilise le même bouton, qui devient « submit » pendant le clic
              sur « Continuer » et envoie la commande sans qu'on ait appuyé sur Commander. */}
          {step < 2 ? (
            <button key="next" type="button" onClick={next} className="hidden w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-[17px] font-semibold text-white lg:block">
              {t("Continuer")}
            </button>
          ) : (
            <button
              key="submit"
              type="submit"
              disabled={blocked}
              className="hidden w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-[17px] font-semibold text-white disabled:opacity-40 lg:block"
            >
              {confirmLabel}
            </button>
          )}
        </aside>
      </div>

      {picker && (
        <MapPicker
          title="Point de livraison"
          initial={position ?? restaurantPoint}
          onClose={() => setPicker(false)}
          onPick={(p) => {
            setDrop(p, "map");
            setPicker(false);
          }}
        />
      )}

      <div className="glass hairline-t fixed inset-x-0 bottom-0 z-30 space-y-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto max-w-2xl">{missingNote}</div>
        {step < 2 ? (
          <button
            key="next"
            type="button"
            onClick={next}
            className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-2xl bg-emerald-600 px-5 py-3.5 text-[17px] font-semibold text-white transition active:scale-[0.98]"
          >
            <span className="inline-flex items-center gap-2">
              {t("Continuer")}
              <Icon name="chevron" className="h-4 w-4" />
            </span>
            <span className="whitespace-nowrap text-right text-[15px] font-normal leading-tight opacity-90">
              {feeKnown ? fcfa(total) : `${fcfa(cart.subtotal)} + ${t("livraison")}`}
              {feeKnown && delivery && <span className="block text-[12px] opacity-90">{t("dont livraison {fee}", { fee: deliveryFee === 0 ? t("gratuite") : fcfa(deliveryFee) })}</span>}
            </span>
          </button>
        ) : (
          <button
            key="submit"
            type="submit"
            disabled={blocked}
            className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-2xl bg-emerald-600 px-5 py-3.5 text-[17px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            {/* Sur téléphone : action en gras, mode de paiement en petit dessous, total à droite. */}
            <span className="text-left leading-tight">
              {blocked ? confirmLabel : t("Commander")}
              {!blocked && (
                <span className="block text-[13px] font-normal opacity-80">
                  {paymentMethod === "CASH" ? t("Paiement à la livraison") : t("Paiement par mobile money")}
                </span>
              )}
            </span>
            <span className="whitespace-nowrap text-right leading-tight">
              {fcfa(total)}
              {delivery && <span className="block text-[12px] font-normal opacity-90">{t("dont livraison {fee}", { fee: deliveryFee === 0 ? t("gratuite") : fcfa(deliveryFee) })}</span>}
            </span>
          </button>
        )}
      </div>
    </form>
  );
}
