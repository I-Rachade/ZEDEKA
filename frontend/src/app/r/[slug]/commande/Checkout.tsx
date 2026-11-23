"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { field } from "@/components/ContactFields";
import OrderCreated from "@/components/OrderCreated";
import { Icon } from "@/components/panel/icons";
import MapPicker, { type Point } from "@/components/MapPicker";
import PointPreview from "@/components/PointPreview";
import RecipientRequest, { type SharedPosition } from "@/app/colis/RecipientRequest";
import { CancellationNote, TermsNotice, type Cancellation } from "@/components/legal/TermsConsent";
import { ACTIVE_PROMO_KEY, checkPromo, createOrder, deliveryPrice, type PromoCheck, fcfa, locateZone, type CreatedOrder, type LocationRequest, type ParcelPricing, type Restaurant, type Zone } from "@/lib/api";
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
import { readStored, useHydrated, writeStored } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { describe, unitPrice, useRestaurantCart } from "../useRestaurantCart";


// pricing : tarif au km des repas (réglages), entre le restaurant et le point de livraison, ou par zone (mode ZONE).
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
      <h2 className="mb-2 px-4 text-[13px] font-normal uppercase tracking-wide text-stone-500">{t(title)}</h2>
      <div className="space-y-3 rounded-[12px] bg-surface p-4">{children}</div>
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

// Caisse sur un seul écran : livraison, contact et paiement déjà remplis autant que possible (position actuelle,
// adresse enregistrée, contact et paiement de la dernière fois). Le client ne touche que pour changer, puis « Commander ».
const PHONE = /^\+?[0-9 ]{8,15}$/;
// Dernier moyen de paiement choisi sur cet appareil : proposé d'office à la commande suivante.
const PAYMENT_KEY = "zedeka.lastPayment";

const option = (on: boolean) =>
  `rounded-[10px] px-3 py-3 text-left transition ${on ? "bg-emerald-600/10 font-semibold text-emerald-800 ring-2 ring-emerald-600" : "bg-stone-100"}`;

// Caisse : sans compte, le client commande directement avec son nom et son numéro (la commande est rattachée à son
// compte s'il se connecte plus tard avec ce numéro). À gauche la livraison, à droite le récapitulatif.
export default function Checkout({ restaurant, zones, mobileMoney, pricing, cancellation }: Props) {
  const hydrated = useHydrated();
  const t = useT();
  const shop = restaurant.kind === "SHOP"; // boutique : mots d'une boutique (article, « Boutique fermée »)
  const session = useSession();
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
  const [noteOpen, setNoteOpen] = useState(false);
  // Point de livraison connu : affiché sur une ligne ; « Changer » rouvre les choix (position, autre personne, carte).
  const [changing, setChanging] = useState(false);
  const [landmarkOpen, setLandmarkOpen] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  // Adresses enregistrées avec une position : un raccourci pour le point de livraison.
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Livraisons offertes du parrainage encore disponibles sur le compte.
  const [freeDeliveries, setFreeDeliveries] = useState(0);
  const [useFree, setUseFree] = useState(false);
  useEffect(() => {
    if (!session) return;
    customerFetch<Profile>("/me").then(
      (p) => {
        setAddresses(p.addresses.filter((a) => a.latitude !== null && a.longitude !== null));
        setFreeDeliveries(p.freeDeliveries ?? 0);
        setProfileLoaded(true);
      },
      () => {
        setAddresses([]);
        setProfileLoaded(true);
      },
    );
  }, [session]);
  // Comptes entreprise du client (bureau, école) : « Facturer à l'entreprise », rien à payer à la livraison.
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return setCompanies([]);
    customerFetch<{ id: string; name: string }[]>("/companies").then(setCompanies, () => setCompanies([]));
  }, [session]);
  const [addressChoice, setAddressChoice] = useState<string | null>(null);
  const savedAddress = addresses.find((a) => a.id === (addressChoice ?? place?.addressId));

  const [fulfillment, setFulfillment] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">(() => (readStored<string>(PAYMENT_KEY) === "MOBILE_MONEY" ? "MOBILE_MONEY" : "CASH"));

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

  // Zone déduite du point (affichée ; elle répartit les livreurs, et fixe le prix si les réglages facturent par zone).
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
  // Même calcul que l'API : au km depuis le restaurant (restaurant sans position : centre de sa zone), sinon le minimum ;
  // ou, facturation par zone, prix fixe de la zone du point de livraison.
  const restaurantZone = zones.find((z) => z.id === restaurant.zone?.id);
  const restaurantPoint =
    restaurant.latitude !== null && restaurant.longitude !== null ? { latitude: restaurant.latitude, longitude: restaurant.longitude } : null;
  const priceFrom = restaurantPoint ?? { latitude: restaurantZone?.latitude ?? null, longitude: restaurantZone?.longitude ?? null };
  const km = position ? distanceKm(position, priceFrom) : null;
  const zone = zones.find((z) => z.id === (zoneId ?? restaurant.zone?.id));
  const deliveryFee = !delivery || !pricing ? 0 : deliveryPrice(pricing, km, zone);
  const feeKnown = !delivery || !!position;
  const belowMinimum = cart.subtotal < restaurant.minOrderAmount;
  // Code promo : aperçu de la remise (le serveur la recalcule à la commande). Un code activé sur l'accueil, ou la
  // promotion du restaurant, est proposé tout seul.
  const [promoText, setPromoText] = useState<string>(() => readStored<string>(ACTIVE_PROMO_KEY) ?? restaurant.promo?.code ?? "");
  const [promo, setPromo] = useState<PromoCheck | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const feeForPromo = feeKnown ? deliveryFee : 0;
  async function applyPromo(code = promoText, quiet = false) {
    if (!code.trim()) return;
    setPromoBusy(true);
    try {
      setPromo(await checkPromo({ code, restaurantSlug: restaurant.slug, subtotal: cart.subtotal, deliveryFee: feeForPromo, customerPhone: phone || undefined }));
      setPromoError(null);
    } catch (e) {
      setPromo(null);
      if (!quiet) setPromoError((e as Error).message);
    } finally {
      setPromoBusy(false);
    }
  }
  // Panier ou livraison changés : la remise se recalcule ; code proposé d'office : essayé sans message d'erreur.
  useEffect(() => {
    if (promoText.trim()) void applyPromo(promo?.code ?? promoText, !promo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.subtotal, feeForPromo]);
  // Livraison offerte du parrainage : en livraison, prix connu, sans code promo (le serveur vérifie à nouveau).
  const canUseFree = !!session && freeDeliveries > 0 && delivery && feeKnown && deliveryFee > 0 && !promo;
  const freeDiscount = canUseFree && useFree ? deliveryFee : 0;
  const discount = (promo?.discount ?? 0) + freeDiscount;
  const total = cart.subtotal + (feeKnown ? deliveryFee : 0) - discount;
  const noPoint = delivery && !position;
  const compact = !!position && !changing;

  // Point de livraison proposé d'office : l'adresse enregistrée choisie, sinon la position actuelle, cherchée dès
  // l'ouverture (une seule fois). En cas de refus, rien ne s'affiche en rouge : le client choisit lui-même.
  const autoLocated = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoLocated.current || !hydrated || fulfillment !== "DELIVERY" || position || mode !== null) return;
    if (session && !profileLoaded) return;
    autoLocated.current = true;
    setMode("gps");
    locate(true);
  });

  function setDrop(p: Point, f: DropFrom) {
    setChanging(false);
    setMissing((m) => m.filter((x) => x !== "point"));
    setDropChoice(p);
    setDropFrom(f);
    rememberPosition(p);
  }

  function pickAddress(a: Address) {
    setChanging(false);
    setAddressChoice(a.id);
    setDropChoice(null);
    setDropFrom(null);
    setMode(null);
    setOtherWay(null);
    setLandmark(null);
    savePlace({ addressId: a.id, zoneId: a.zone.id, label: a.label });
  }

  // quiet : recherche automatique à l'ouverture ; un échec remet simplement les deux choix, sans message d'erreur.
  function locate(quiet = false) {
    const fail = () => {
      setLocating(quiet ? "idle" : "error");
      if (quiet) setMode((m) => (m === "gps" ? null : m));
    };
    if (!("geolocation" in navigator)) return fail();
    setLocating("loading");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setDrop({ latitude: p.coords.latitude, longitude: p.coords.longitude }, "gps");
        setAccuracy(p.coords.accuracy ?? null);
        setLocating("idle");
      },
      fail,
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function chooseMode(m: DropMode) {
    setMode(m);
    if (m === "gps") return locate(false);
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

  function gaps(): string[] {
    return [noPoint && "point", name.trim().length < 2 && "name", !PHONE.test(phone.trim()) && "phone"].filter((x): x is string => !!x);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // Le bouton n'est jamais grisé pour un oubli : il signale ce qui manque, en rouge, et y conduit.
    const missingNow = gaps();
    if (missingNow.length > 0) {
      setMissing(missingNow);
      if (missingNow.includes("name") || missingNow.includes("phone")) setContactOpen(true);
      setTimeout(() => document.getElementById(`checkout-${missingNow[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
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
        paymentMethod: companyId && delivery ? "CASH" : paymentMethod,
        ...(companyId && delivery ? { companyId } : {}),
        promoCode: promo?.code,
        ...(freeDiscount > 0 ? { useFreeDelivery: true } : {}),
        // Position partagée par la personne livrée : l'API la lit sur la demande ; sinon le point lui-même.
        ...(delivery && from === "recipient" && request ? { locationRequestKey: request.pollKey } : delivery && position ? position : {}),
        items: cart.lines.map((l) => ({
          menuItemId: l.item.id,
          quantity: l.quantity,
          variantId: l.variantId,
          addonIds: l.addonIds,
          choices: l.choices,
        })),
      });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(30);
      if (!session) rememberContact({ name: name.trim(), phone: phone.trim() });
      if (promo) writeStored(ACTIVE_PROMO_KEY, null);
      writeStored(PAYMENT_KEY, paymentMethod);
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
    <Link href={`/r/${restaurant.slug}`} className="-ml-2 inline-flex items-center text-[17px] text-emerald-600 active:opacity-50">
      <Icon name="back" className="h-6 w-6" />
      {restaurant.name}
    </Link>
  );

  if (cart.count === 0)
    return (
      <div className="space-y-4">
        {back}
        <p className="rounded-[12px] bg-surface p-6 text-center">{shop ? t("Votre panier est vide. Choisissez des articles dans la boutique.") : t("Votre panier est vide. Choisissez des plats sur la carte.")}</p>
      </div>
    );

  const confirmLabel = submitting
    ? t("Envoi…")
    : !restaurant.availability.open
      ? shop
        ? t("Boutique fermée")
        : t("Restaurant fermé")
      : belowMinimum
        ? t("Minimum {amount}", { amount: fcfa(restaurant.minOrderAmount) })
        : paymentMethod === "CASH"
          ? t("Commander · payer à la livraison")
          : t("Commander · payer par mobile money");
  // Heure d'arrivée annoncée sur le bouton : maintenant + délai annoncé par le restaurant.
  const arrival = new Date(Date.now() + restaurant.deliveryTimeMax * 60_000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
  const blockedReason = submitting || belowMinimum || !restaurant.availability.open;
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
    <form id="checkout" onSubmit={submit} noValidate className="space-y-5 pb-40 lg:pb-0">
      {back}
      <h1 className="text-[30px] font-bold leading-tight">{t("Votre commande")}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section>
            <div className="mb-3 flex rounded-[12px] bg-stone-200/70 p-[3px]" role="group" aria-label={t("Mode de retrait")}>
              {(["DELIVERY", "PICKUP"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFulfillment(f)}
                  aria-pressed={fulfillment === f}
                  className={`flex-1 rounded-[10px] px-3 py-2 text-[15px] transition ${fulfillment === f ? "bg-surface font-semibold shadow-sm" : "text-stone-600"}`}
                >
                  {f === "DELIVERY" ? t("Livraison") : t("À emporter")}
                  <span className="block text-xs font-normal text-stone-500">
                    {f === "DELIVERY" ? `${restaurant.deliveryTimeMin}–${restaurant.deliveryTimeMax} min` : restaurant.address}
                  </span>
                </button>
              ))}
            </div>
            {delivery && (
              <Card title="Livrer à">
                {compact && position ? (
                  // Point déjà connu (position actuelle, adresse enregistrée, lien partagé) : une ligne et « Changer ».
                  <div id="checkout-point" className="flex items-start gap-3">
                    <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1 text-[15px]">
                      <p className="font-semibold">
                        {from === "recipient"
                          ? t("Position reçue de la personne livrée")
                          : from === "gps"
                            ? t("Ma position actuelle")
                            : from === "saved" && savedAddress
                              ? `${t(savedAddress.label)} · ${savedAddress.quarter}`
                              : t("Point placé")}
                      </p>
                      {km !== null && <p className="text-[13px] text-stone-500">{t(shop ? "{km} de la boutique" : "{km} du restaurant", { km: kmLabel(km) })}</p>}
                      <p key={deliveryFee} className="anim-fade-up text-[13px] font-semibold text-stone-800">
                        {t("Livraison : {fee}", { fee: deliveryFee === 0 ? t("gratuite") : fcfa(deliveryFee) })}
                      </p>
                    </div>
                    <button type="button" onClick={() => setChanging(true)} className="shrink-0 text-[15px] font-semibold text-emerald-700">
                      {t("Changer")}
                    </button>
                  </div>
                ) : (
                  <>
                {addresses.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {addresses.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => pickAddress(a)}
                        className={`rounded-full border px-3 py-2 text-sm ${from === "saved" && savedAddress?.id === a.id ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-300"}`}
                      >
                        {t(a.label)} · {a.quarter}
                      </button>
                    ))}
                    <Link href="/app/adresses" className="rounded-full px-3 py-2 text-sm text-emerald-600">
                      {t("Gérer")}
                    </Link>
                  </div>
                )}
                <div
                  id="checkout-point"
                  className={`grid grid-cols-2 gap-2 rounded-[10px] ${missing.includes("point") ? "ring-2 ring-red-400 ring-offset-2" : ""}`}
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
                        km !== null ? t(shop ? "{km} de la boutique" : "{km} du restaurant", { km: kmLabel(km) }) : null,
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

                  </>
                )}
                {landmarkOpen || landmark.trim() ? (
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
                ) : (
                  <button type="button" onClick={() => setLandmarkOpen(true)} className="text-sm text-emerald-700">
                    + {t("Un repère pour le livreur (portail, couleur…)")}
                  </button>
                )}

              </Card>
            )}
          </section>

          <Card title="Pour vous joindre">
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
                  {t("Pas besoin de compte : votre numéro suffit pour suivre la commande.")}{" "}
                  <Link href={`/app/connexion?suite=${encodeURIComponent(`/r/${restaurant.slug}/commande`)}`} className="text-emerald-600">
                    {t("J'ai un compte")}
                  </Link>
                </p>
              )}
            {noteOpen ? (
              <textarea
                name="note"
                autoFocus
                aria-label={shop ? t("Note pour la boutique") : t("Note pour le restaurant")}
                rows={2}
                placeholder={shop ? t("Note pour la boutique (facultatif)") : t("Note pour le restaurant (facultatif)")}
                className={field}
              />
            ) : (
              <button type="button" onClick={() => setNoteOpen(true)} className="text-sm text-emerald-700">
                + {shop ? t("Une note pour la boutique") : t("Une note pour le restaurant")}
              </button>
            )}
          </Card>

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
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-sun text-xs font-extrabold text-ink-deep ring-2 ring-white">T</span>
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#0369a1] text-xs font-extrabold text-white ring-2 ring-white">F</span>
                    </span>
                    <span>
                      {t("Mobile money")}
                      <span className="block text-xs font-normal text-stone-600">{t("T-Money ou Flooz")}</span>
                    </span>
                  </button>
                )}
              </div>
              {delivery && companies.length > 0 && (
                <div className="space-y-2">
                  {companies.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 rounded-[10px] bg-sky-50 px-3 py-3 text-[14px] text-sky-950">
                      <input type="checkbox" checked={companyId === c.id} onChange={(e) => setCompanyId(e.target.checked ? c.id : null)} className="h-5 w-5" />
                      <span>
                        <span className="font-semibold">{t("Facturer à {name}", { name: c.name })}</span>
                        <span className="block text-xs">{t("Rien à payer à la livraison : la commande va sur la facture mensuelle de l'entreprise.")}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {change && !companyId && (
                <p className="rounded-[10px] bg-sun-soft p-3 text-[13px] text-amber-950">
                  {t("Si possible, préparez l'appoint : avec un billet de {note}, le livreur doit vous rendre {change}.", {
                    note: change.note.toLocaleString("fr-FR"),
                    change: fcfa(change.change),
                  })}
                </p>
              )}
            </Card>
          {/* Ce qui rassure avant de toucher « Commander » : rien n'est payé maintenant, et l'annulation. */}
          <p className="flex items-start gap-2 rounded-[12px] bg-emerald-50 p-3 text-[14px] text-emerald-900">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {companyId && delivery ? t("Rien à payer à la livraison : la commande va sur la facture mensuelle de l'entreprise.") : paymentMethod === "CASH" ? t("Vous ne payez rien maintenant : vous réglez à la livraison.") : t("Vous payez par mobile money une fois la commande acceptée.")}{" "}
              {cancellation && <CancellationNote {...cancellation} />}
            </span>
          </p>
        </div>

        <aside className="space-y-3 rounded-[12px] bg-surface p-4 lg:sticky lg:top-20">
          <h2 className="text-[17px] font-semibold">{t("Votre commande")}</h2>
          <ul className="space-y-2 text-sm">
            {cart.lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <button type="button" onClick={() => cart.change(l.key, -1)} aria-label={t("Retirer {name}", { name: describe(l) })} className="hit grid h-7 w-7 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-700">
                    −
                  </button>
                  <span key={l.quantity} className="anim-bump w-4 shrink-0 text-center font-medium">{l.quantity}</span>
                  <button type="button" onClick={() => cart.change(l.key, 1)} aria-label={t("Ajouter encore {name}", { name: describe(l) })} className="hit grid h-7 w-7 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-700">
                    +
                  </button>
                  <span className="min-w-0">{describe(l)}</span>
                </span>
                <span className="shrink-0">{fcfa(unitPrice(l.item, l.variantId, l.addonIds) * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <Link href={`/r/${restaurant.slug}`} className="block text-sm text-emerald-600">
            {t("Ajouter autre chose")}
          </Link>
          {/* Repas planifiés et commandes groupées : accessibles d'ici, puisque la barre du bas saute le panier. */}
          {!shop && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href={`/r/${restaurant.slug}/planifier`} className="text-emerald-700">
                🕒 {t("Planifier pour plus tard ou formule cantine")}
              </Link>
              <Link href={`/r/${restaurant.slug}/groupe`} className="text-emerald-700">
                👥 {t("Commande groupée (bureau, école)")}
              </Link>
            </div>
          )}
          <div className="hairline-t space-y-2 pt-3">
            {promo ? (
              <>
                <div className="flex items-center gap-2 rounded-[10px] px-3 py-3 ring-2 ring-emerald-600">
                  <span className="flex-1 font-mono text-[15px] font-semibold">{promo.code}</span>
                  <span className="text-[14px] font-semibold text-emerald-700">✓ {t("Appliqué")}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPromo(null);
                      setPromoText("");
                    }}
                    aria-label={t("Retirer le code")}
                    className="text-stone-400"
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
                <p className="rounded-[10px] bg-emerald-50 px-3 py-2 text-[14px] font-semibold text-emerald-800">{promo.label}</p>
              </>
            ) : !promoOpen && !promoText ? (
              <button type="button" onClick={() => setPromoOpen(true)} className="text-[15px] font-semibold text-emerald-700">
                + {t("Code promo")}
              </button>
            ) : (
              <div className="flex gap-2">
                <input
                  value={promoText}
                  onChange={(e) => {
                    setPromoText(e.target.value.toUpperCase());
                    setPromoError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyPromo();
                    }
                  }}
                  aria-label={t("Code promo")}
                  placeholder={t("ex. ZED20")}
                  autoCapitalize="characters"
                  className="min-w-0 flex-1 rounded-[10px] bg-stone-100 px-3 py-3 font-mono text-[15px] uppercase outline-none focus:ring-2 focus:ring-emerald-600/40"
                />
                <button type="button" onClick={() => applyPromo()} disabled={!promoText.trim() || promoBusy} className="shrink-0 rounded-[10px] bg-emerald-600 px-4 font-semibold text-white disabled:opacity-40">
                  {promoBusy ? "…" : t("Appliquer")}
                </button>
              </div>
            )}
            {promoError && <p className="text-[13px] text-red-700">{promoError}</p>}
            {canUseFree && (
              <label className="flex items-center gap-3 rounded-[10px] bg-emerald-50 px-3 py-3 text-[14px] text-emerald-900">
                <input type="checkbox" checked={useFree} onChange={(e) => setUseFree(e.target.checked)} className="h-5 w-5 accent-emerald-600" />
                <span className="flex-1">{t("Utiliser une livraison offerte ({n} disponible(s))", { n: freeDeliveries })}</span>
              </label>
            )}
          </div>
          <dl className="hairline-t space-y-2 pt-3 text-[15px]">
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
            {freeDiscount > 0 && (
              <div className="flex justify-between font-semibold text-emerald-700">
                <dt>{t("Livraison offerte (parrainage)")}</dt>
                <dd>-{fcfa(freeDiscount)}</dd>
              </div>
            )}
            {promo && (
              <div className="flex justify-between font-semibold text-emerald-700">
                <dt>{t("Promo {code}", { code: promo.code })}</dt>
                <dd>-{fcfa(promo.discount)}</dd>
              </div>
            )}
            <div className="hairline-t flex justify-between pt-3 text-[17px] font-semibold">
              <dt>{t("Total")}</dt>
              <dd>{fcfa(total)}</dd>
            </div>
          </dl>
          {noPoint && (
            <p className="text-xs text-stone-500">{shop ? t("Indiquez le point de livraison : le prix se calcule sur la distance depuis la boutique.") : t("Indiquez le point de livraison : le prix se calcule sur la distance depuis le restaurant.")}</p>
          )}
          {belowMinimum && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {t(shop ? "Commande minimum : {min}. Ajoutez encore {amount} d'articles." : "Commande minimum : {min}. Ajoutez encore {amount} de plats.", {
                min: fcfa(restaurant.minOrderAmount),
                amount: fcfa(restaurant.minOrderAmount - cart.subtotal),
              })}
            </p>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="hidden lg:block">{missingNote}</div>
          <button type="submit" disabled={blockedReason} className="hidden w-full rounded-2xl bg-emerald-600 px-4 py-4 text-[17px] font-semibold text-white disabled:opacity-40 lg:block">
            {confirmLabel}
          </button>
          <TermsNotice action="commandant" />
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
        <button
          type="submit"
          disabled={blockedReason}
          className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-2xl bg-emerald-600 px-5 py-4 text-[17px] font-semibold text-white shadow-[0_8px_24px_rgb(5_150_105/0.35)] transition active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
        >
          {/* Sur téléphone : action en gras, heure d'arrivée en petit dessous, total à droite. */}
          <span className="text-left leading-tight">
            {blockedReason ? confirmLabel : t("Commander")}
            {!blockedReason && <span className="block text-[13px] font-normal opacity-85">{delivery && feeKnown ? t("Arrivée vers {time}", { time: arrival }) : paymentMethod !== "CASH" ? t("Paiement par mobile money") : delivery ? t("Paiement à la livraison") : t("Paiement au retrait")}</span>}
          </span>
          <span key={total} className="anim-bump whitespace-nowrap text-right leading-tight">
            {feeKnown ? fcfa(total) : fcfa(cart.subtotal)}
            {delivery && <span className="block text-[12px] font-normal opacity-90">{feeKnown ? t("dont livraison {fee}", { fee: deliveryFee === 0 ? t("gratuite") : fcfa(deliveryFee) }) : t("+ livraison")}</span>}
          </span>
        </button>
        <div className="mx-auto max-w-2xl">
          <TermsNotice action="commandant" />
        </div>
      </div>
    </form>
  );
}
