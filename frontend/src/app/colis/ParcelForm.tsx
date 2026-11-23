"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { drop, isNetworkFailure, newClientKey, queue } from "@/lib/outbox";
import { TopBar, card, input } from "@/app/app/ui";
import {
  CancellationNote,
  TermsNotice,
  type Cancellation,
} from "@/components/legal/TermsConsent";
import { Icon } from "@/components/panel/icons";
import OrderCreated from "@/components/OrderCreated";
import LocationLinkCard from "@/components/LocationLinkCard";
import MapPicker, { type Point } from "@/components/MapPicker";
import PointPreview from "@/components/PointPreview";
import { useI18n, useT } from "@/lib/i18n/client";
import { bookingDays, whenLabel } from "@/lib/booking";
import { customerFetch, type Address, type Profile } from "@/lib/customer";
import { slotIso } from "@/lib/serviceRequests";
import RecipientRequest, { type SharedPosition } from "./RecipientRequest";
import ZedSwitch from "@/app/app/ZedSwitch";

// Même carte que la page Course Zed : le point de retrait au centre.
const NearbyMap = dynamic(() => import("@/app/app/zed/NearbyMap"), { ssr: false });
import {
  distanceKm,
  findRecipient,
  km as kmLabel,
  rememberContact,
  rememberRecipient,
  useContact,
  useSession,
  type KnownRecipient,
} from "@/lib/customer";
import {
  apiGet,
  createParcel,
  fcfa,
  byZone,
  deliveryPrice,
  locateZone,
  resolveMapsLink,
  type CreatedOrder,
  type NewParcel,
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

// Taille demandée par l'API, déduite du poids (le client ne la choisit plus).
type Size = "SMALL" | "MEDIUM" | "LARGE";

// Pictogramme d'un type de colis, d'après son nom choisi dans l'admin.
const CATEGORY_EMOJI: [RegExp, string][] = [
  [/docu|papier|lettre|enveloppe/i, "📄"],
  [/v[eê]te|habit|tissu|pagne/i, "👕"],
  [/nourrit|repas|aliment|plat|food/i, "🍲"],
  [/fragile|[ée]lectro|t[ée]l[ée]phone|verre/i, "📱"],
  [/m[ée]dic|pharma/i, "💊"],
];
const emojiOf = (name: string) =>
  CATEGORY_EMOJI.find(([re]) => re.test(name))?.[1] ?? "📦";
// Envoi pas à pas : une question par écran. Le récapitulatif (5e écran) n'a pas de pastille de progression.
const STEP_TITLES = ["D'où part le colis ?", "Qui le reçoit ?", "Où le livrer ?", "Qu'envoyez-vous ?", "Tout est bon ?"] as const;
const STEP_OF: Record<string, number> = { pickupAddress: 0, name: 1, phone: 1, recipientName: 1, recipientPhone: 1, address: 2, category: 3, weight: 3 };

// Poids retenu d'office pour un type de colis, d'après son nom choisi dans l'admin ; la taille en découle.
const KG_OF: [RegExp, number][] = [
  [/docu|papier|lettre|enveloppe/i, 0.5],
  [/gros|lourd|grand/i, 15],
  [/petit/i, 3],
];
const defaultKg = (name: string) => KG_OF.find(([re]) => re.test(name))?.[1] ?? 3;
const sizeOf = (kg: number): Size => (kg < 1 ? "SMALL" : kg <= 10 ? "MEDIUM" : "LARGE");

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

// Pastille de choix, comme sur la planche : ronde, cerclée de vert quand elle est choisie.
const pill = (on: boolean, missing = false) =>
  `inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-[15px] transition ${on ? "bg-emerald-600 font-semibold text-white" : missing ? "bg-red-50 ring-1 ring-red-400" : "bg-surface ring-1 ring-stone-200"}`;

const chip = (on: boolean, missing = false) =>
  `min-h-11 rounded-[10px] px-3 py-3 text-left text-[15px] [overflow-wrap:anywhere] transition active:scale-[0.97] ${on ? "bg-emerald-600/10 font-semibold text-emerald-800 ring-2 ring-emerald-600" : missing ? "bg-red-50 ring-1 ring-red-400" : "bg-stone-100"}`;

function Legend({
  children,
  missing,
}: {
  children: React.ReactNode;
  missing?: boolean;
}) {
  const t = useT();
  return (
    <legend
      className={`mb-2 text-[13px] uppercase tracking-wide ${missing ? "text-red-600" : "text-stone-500"}`}
    >
      {children}
      {missing && (
        <span className="ml-1 normal-case tracking-normal">
          · {t("à choisir")}
        </span>
      )}
    </legend>
  );
}

// Envoi d'un colis sur un seul écran, comme sur la planche : départ et arrivée, type, poids et taille, qui paie,
// puis le prix détaillé. Le bouton du bas n'est jamais grisé : s'il manque quelque chose, il le signale et y conduit.
export default function ParcelForm({
  zones,
  categories,
  pricing,
  mobileMoney,
  cancellation,
}: {
  zones: Zone[];
  categories: ParcelCategory[];
  pricing: ParcelPricing;
  mobileMoney: boolean;
  cancellation: Cancellation | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const session = useSession();
  const contact = useContact();
  const [step, setStep] = useState(0);
  const [pickupFromGps, setPickupFromGps] = useState(false);
  const [editSender, setEditSender] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
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
  const [dropFrom, setDropFrom] = useState<
    "map" | "link" | "recipient" | "known" | null
  >(null);
  const [mode, setMode] = useState<DropMode | null>(null);
  const [locating, setLocating] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [picker, setPicker] = useState<"pickup" | "drop" | null>(null);
  const [link, setLink] = useState("");
  const [linkState, setLinkState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [request, setRequest] = useState<LocationRequest | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [zoneId, setZoneId] = useState<string | null | undefined>(undefined);
  const [known, setKnown] = useState<KnownRecipient | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">(
    "CASH",
  );
  // Qui paie la livraison : l'expéditeur, ou le destinataire en espèces à la réception.
  const [payer, setPayer] = useState<"SENDER" | "RECIPIENT">("SENDER");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);
  const [queued, setQueued] = useState<{
    estimate: number | null;
    at: number;
  } | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const clientKey = useRef<string | null>(null);
  // Retrait « maintenant » ou programmé (jour et heure, jusqu'à 7 jours), comme une course Zed réservée.
  const [later, setLater] = useState(false);
  const days = useMemo(() => bookingDays(locale, new Date()), [locale, later]); // eslint-disable-line react-hooks/exhaustive-deps
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const dayOk = days.find((d) => d.value === day) ?? days[0];
  const timeOk = dayOk && dayOk.times.includes(time) ? time : (dayOk?.times[0] ?? "");
  const pickupAt = later && dayOk && timeOk ? slotIso(dayOk.value, timeOk) : null;
  // Carte du haut : le point de retrait, ou la position du téléphone en attendant ; adresses enregistrées du client.
  const [here, setHere] = useState<Point | null>(null);
  const [places, setPlaces] = useState<Address[]>([]);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setHere({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, []);
  // Départ proposé d'office : la position du téléphone, dès qu'elle est connue (« C'est ici » suffit).
  useEffect(() => {
    if (!here || pickupPos || written(typed.pickupAddress ?? "")) return;
    setPickupPos(here);
    setPickupFromGps(true);
  }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session) return;
    customerFetch<Profile>("/me").then((p) => setPlaces(p.addresses), () => {});
  }, [session]);
  // Adresse enregistrée choisie comme point de retrait : texte et position, si elle en a une.
  function pickupFrom(a: Address) {
    set("pickupAddress", [a.quarter, a.landmark].filter(Boolean).join(", "));
    setPickupFromGps(false);
    if (a.latitude !== null && a.longitude !== null) setPickupPos({ latitude: a.latitude, longitude: a.longitude });
    setMissing((m) => m.filter((x) => x !== "pickupAddress"));
  }

  const category = categories.find((c) => c.id === categoryId);
  const extra = extraFee(category, weight ?? 0);
  const km = pickupPos && dropPos ? distanceKm(pickupPos, dropPos) : null;
  // Facturation par zone (réglages) : prix fixe de la zone du point de livraison, connu dès que ce point l'est.
  const dropZone =
    dropPos && zoneId ? zones.find((z) => z.id === zoneId) : null;
  const zonePriced = byZone(pricing, dropZone);
  const fee = deliveryPrice(pricing, km, dropZone);
  // Prix connu : distance connue, ou prix de la zone de livraison.
  const priceKnown = km !== null || zonePriced;
  // Lien envoyé, pas encore de réponse : la commande attendra la position, et son prix.
  const priceLater = !dropPos && !!request && mode === "ask";
  // Sans les deux positions (adresse écrite) ni prix de zone : tarif minimum, confirmé par Zedeka.
  const priceToConfirm = !priceKnown && !priceLater;
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

  const missingAll = () => [0, 1, 2, 3].flatMap(missingFor);

  function missingFor(st: number): string[] {
    const bad = (keys: FieldKey[]) => TEXT_FIELDS.filter((f) => keys.includes(f.key) && !f.ok(value(f.key))).map((f) => f.key as string);
    // Départ comme arrivée : l'adresse écrite ou la position, l'une des deux suffit.
    if (st === 0) return pickupPos || written(value("pickupAddress")) ? [] : ["pickupAddress"];
    if (st === 1) return bad(["name", "phone", "recipientName", "recipientPhone"]);
    if (st === 2) return dropPos || request || written(value("address")) ? [] : ["address"];
    if (st === 3) return [!categoryId && "category", weight === null && "weight"].filter((x): x is string => !!x);
    return [];
  }

  // Signale ce qui manque, en rouge, et y conduit (champ mis en avant, et ouvert s'il était replié).
  function flag(gaps: string[]) {
    setMissing(gaps);
    if (gaps.some((g) => g === "name" || g === "phone")) setEditSender(true);
    setTimeout(() => {
      const el = document.getElementById(`colis-${gaps[0]}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
    }, 60);
  }

  function go(st: number) {
    setStep(st);
    setMissing([]);
    setError(null);
    window.scrollTo({ top: 0 });
  }

  // « Continuer » : jamais grisé, il montre ce qui manque à cet écran, sinon passe au suivant.
  function forward() {
    const gaps = missingFor(step);
    if (gaps.length > 0) return flag(gaps);
    go(step + 1);
  }

  function chooseCategory(c: ParcelCategory) {
    setCategoryId(c.id);
    const kg = defaultKg(c.name);
    setWeight(kg);
    setSize(sizeOf(kg));
    setMissing([]);
    // Sans supplément au poids, rien d'autre à demander : on passe tout seul au récapitulatif.
    if (!c.perKgFee) setTimeout(() => go(4), 250);
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
    if (known.address && !value("address").trim())
      set("address", known.address);
    if (known.latitude !== null && known.longitude !== null) {
      setMode(null);
      setDrop(
        { latitude: known.latitude, longitude: known.longitude },
        "known",
      );
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

  async function next() {
    const gaps = missingAll();
    if (gaps.length > 0) {
      // Retour à l'écran de la première information manquante.
      setStep(STEP_OF[gaps[0]] ?? 0);
      return flag(gaps);
    }

    setSubmitting(true);
    setError(null);
    const payload: NewParcel = {
      acceptTerms: true,
      customerName: value("name").trim(),
      customerPhone: value("phone").trim(),
      pickupAddress: value("pickupAddress").trim(),
      pickupLatitude: pickupPos?.latitude,
      pickupLongitude: pickupPos?.longitude,
      address: value("address").trim(),
      // Position partagée par le destinataire : l'API la lit sur la demande ; sinon le point placé ou collé.
      ...(request && (dropFrom === "recipient" || priceLater)
        ? { locationRequestKey: request.pollKey }
        : {}),
      ...(dropPos && dropFrom !== "recipient"
        ? { latitude: dropPos.latitude, longitude: dropPos.longitude }
        : {}),
      recipientName: value("recipientName").trim(),
      recipientPhone: value("recipientPhone").trim(),
      parcelCategoryId: categoryId,
      weightKg: weight!,
      parcelSize: size!,
      note: note.trim() || undefined,
      paymentMethod: payer === "RECIPIENT" ? "CASH" : paymentMethod,
      payer,
      ...(pickupAt ? { pickupAt } : {}),
    };
    // Une seule clé par colis préparé : renvoyé au retour du réseau, il n'est jamais créé deux fois.
    clientKey.current ??= newClientKey();
    try {
      const order = await createParcel({
        ...payload,
        clientKey: clientKey.current,
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
      if ("vibrate" in navigator) navigator.vibrate?.(30);
      setCreated(order);
      window.scrollTo({ top: 0 });
    } catch (err) {
      // Pas de réseau (planche 7) : le colis attend sur le téléphone ; rien ne part sans confirmation.
      if (isNetworkFailure(err)) {
        const to = value("recipientName").trim().split(/\s+/)[0];
        queue({
          id: clientKey.current,
          kind: "PARCEL",
          label: t("Colis vers {name}", { name: to }),
          estimate: priceLater ? null : fee + extra,
          createdAt: Date.now(),
          payload,
        });
        setQueued({
          estimate: priceLater ? null : fee + extra,
          at: Date.now(),
        });
        apiGet<{ whatsapp: string }>("/api/policies")
          .then((p) => p?.whatsapp && setWhatsapp(p.whatsapp))
          .catch(() => {});
        window.scrollTo({ top: 0 });
      } else setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (queued && !created)
    return (
      <>
        <TopBar title="Colis en attente" back="/app" />
        <div className="space-y-3 p-4">
          <section className="flex gap-3 rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <span aria-hidden className="text-2xl">
              ⏳
            </span>
            <div>
              <p className="font-bold">{t("Prêt à envoyer")}</p>
              <p className="text-sm">
                {t(
                  "Pas de réseau : votre colis est gardé sur le téléphone. Le prix sera recalculé au retour du réseau et vous confirmerez l'envoi.",
                )}
              </p>
            </div>
          </section>
          <section className="rounded-[10px] border border-stone-200 bg-surface p-4 text-sm">
            <p>
              <span className="text-stone-500">{t("Récupérer chez")}</span> ·{" "}
              {value("pickupAddress").trim() || t("ma position")}
            </p>
            <p className="mt-1">
              <span className="text-stone-500">{t("Livrer à")}</span> ·{" "}
              {value("recipientName").trim()} ·{" "}
              {value("address").trim() || t("position du destinataire")}
            </p>
            {queued.estimate != null && (
              <p className="mt-3 flex justify-between border-t border-stone-100 pt-3 font-semibold">
                <span>
                  {t("Estimation du {time}", {
                    time: new Date(queued.at).toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })}
                </span>
                <span>~{fcfa(queued.estimate)}</span>
              </p>
            )}
          </section>
          <button
            onClick={() => router.push("/app")}
            className="w-full rounded-[10px] bg-[#0e7c4a] px-4 py-4 font-bold text-white"
          >
            {t("Envoyer dès que le réseau revient")}
          </button>
          {whatsapp && (
            <a
              href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
                t(
                  "Bonjour Zedeka, un colis à envoyer : de {from} à {to} ({phone}), {address}.",
                  {
                    from: value("pickupAddress").trim() || "ma position",
                    to: value("recipientName").trim(),
                    phone: value("recipientPhone").trim(),
                    address: value("address").trim(),
                  },
                ),
              )}`}
              onClick={() => clientKey.current && drop(clientKey.current)}
              className="block w-full rounded-[10px] bg-[#ffb020] px-4 py-4 text-center font-bold text-ink-deep"
            >
              {t("Envoyer par WhatsApp à la place")}
            </a>
          )}
        </div>
      </>
    );

  if (created)
    return (
      <>
        <TopBar title="Colis envoyé" back="/app" />
        <div className="space-y-4 p-4">
          {created.locationLink && (
            <LocationLinkCard
              link={created.locationLink}
              recipientFirstName={value("recipientName").trim().split(/\s+/)[0]}
            />
          )}
          <OrderCreated
            order={created}
            kind="PARCEL"
            stay={!!created.locationLink}
            priceNote={
              created.awaitingPosition
                ? t(
                    "Le prix sera fixé dès que le destinataire aura partagé sa position, et un livreur partira alors.",
                  )
                : created.priceToConfirm
                  ? t(
                      "Livraison au tarif minimum : Zedeka confirmera le prix d'après l'adresse.",
                    )
                  : undefined
            }
          />
        </div>
      </>
    );

  const closed = categories.length === 0;
  const textField = (
    k: FieldKey,
    extraProps: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => {
    const f = TEXT_FIELDS.find((x) => x.key === k)!;
    const bad = missing.includes(k);
    return (
      <label className="block space-y-1">
        <span
          className={`text-sm ${bad ? "font-medium text-red-700" : "text-stone-600"}`}
        >
          {t(f.label)}
        </span>
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
        <span
          className={`text-sm ${bad ? "font-medium text-red-700" : "text-stone-600"}`}
        >
          {labelText ?? t(f.label)}
        </span>
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
    ? t("Envoi de colis indisponible")
    : submitting
      ? t("Envoi…")
      : pickupAt
        ? `${t("Programmer")} · ${whenLabel(pickupAt, locale, t)}`
        : priceLater
          ? t("Trouver un livreur · prix à la réponse")
          : `${t("Trouver un livreur")} · ${fcfa(fee + extra)}${priceToConfirm ? ` ${t("min.")}` : ""}`;

  const firstLine = (v: string) => v.trim().split("\n")[0];
  const pickupText = firstLine(value("pickupAddress")) || (pickupPos ? (pickupFromGps ? t("Ma position") : t("Point placé")) : t("à préciser"));
  const total = fee + extra;
  // Pastille de prix en haut : dès que le prix est connu (les deux points, ou la zone de livraison).
  const pricePill = priceLater ? t("prix à la réponse") : priceKnown ? fcfa(total) : null;
  const senderKnown = !editSender && TEXT_FIELDS.filter((f) => f.key === "name" || f.key === "phone").every((f) => f.ok(value(f.key)));
  const gapNote =
    missing.length > 0 ? (
      <p role="alert" className="px-1 text-sm font-medium text-red-700">
        {missing.length === 1 ? t("Il manque une information, signalée en rouge.") : t("Il manque {n} informations, signalées en rouge.", { n: missing.length })}
      </p>
    ) : null;
  const tile = (on: boolean, bad = false) =>
    `flex w-full items-center gap-3 rounded-[16px] border-2 p-4 text-left transition active:scale-[0.98] ${on ? "border-emerald-600 bg-emerald-50" : bad ? "border-red-300 bg-red-50/60" : "border-transparent bg-surface"}`;
  const tileIcon = "grid h-12 w-12 shrink-0 place-items-center rounded-[12px] bg-stone-100 text-[24px]";

  return (
    <div className="min-h-screen pb-48">
      {/* En-tête : retour (écran précédent), progression en 4 pastilles, prix dès qu'il est connu. */}
      <div className="sticky top-0 z-[600] flex items-center gap-3 bg-[var(--color-background,#f2f2f7)]/90 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur">
        {step === 0 ? (
          <Link href="/app" aria-label={t("Retour")} className="liquid grid h-11 w-11 shrink-0 place-items-center rounded-full">
            <Icon name="back" className="h-5 w-5" />
          </Link>
        ) : (
          <button type="button" onClick={() => go(step - 1)} aria-label={t("Retour")} className="liquid grid h-11 w-11 shrink-0 place-items-center rounded-full">
            <Icon name="back" className="h-5 w-5" />
          </button>
        )}
        <div className="flex flex-1 justify-center gap-1.5" aria-label={t("Étape {n} sur {total}", { n: Math.min(step + 1, 4), total: 4 })}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 w-8 rounded-full transition-colors duration-300 ${i <= step ? "bg-emerald-600" : "bg-stone-300"}`} />
          ))}
        </div>
        <span
          key={pricePill ?? "none"}
          data-testid="price-pill"
          className={`anim-bump shrink-0 rounded-full px-3 py-1.5 text-[14px] font-bold ${pricePill ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-400"}`}
        >
          {pricePill ?? t("Prix")}
        </span>
      </div>

      <div key={step} className="anim-fade-up space-y-4 px-4 pt-2">
        <h1 className="text-[28px] font-bold leading-tight">{t(STEP_TITLES[step])}</h1>
        {closed && (
          <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {t("L'envoi de colis n'est pas encore ouvert : aucun type de colis n'est disponible pour le moment.")}
          </p>
        )}

        {step === 0 && (
          <>
            <div className="relative isolate h-[26vh] min-h-[180px] overflow-hidden rounded-[18px] bg-emerald-50">
              {pickupPos || here ? (
                <NearbyMap key={`${(pickupPos ?? here)!.latitude},${(pickupPos ?? here)!.longitude}`} me={(pickupPos ?? here)!} radiusM={0} drivers={[]} />
              ) : (
                <div className="grid h-full place-items-center text-[14px] text-stone-500">{locating === "loading" ? t("Recherche…") : t("Localisation…")}</div>
              )}
            </div>
            <div id="colis-pickupAddress" className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setPickupFromGps(true);
                  set("pickupAddress", "");
                  locatePickup();
                }}
                aria-pressed={!!pickupPos && pickupFromGps}
                className={tile(!!pickupPos && pickupFromGps, missing.includes("pickupAddress"))}
              >
                <span className={tileIcon} aria-hidden="true">📍</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold">{locating === "loading" ? t("Recherche…") : t("Ma position actuelle")}</span>
                  <span className="block text-[13px] text-stone-500">{t("je suis au point de retrait")}</span>
                </span>
                {pickupPos && pickupFromGps && <Icon name="check" className="h-5 w-5 shrink-0 text-emerald-700" />}
              </button>
              {places.slice(0, 3).map((a) => {
                const on = value("pickupAddress") === [a.quarter, a.landmark].filter(Boolean).join(", ");
                return (
                  <button key={a.id} type="button" onClick={() => pickupFrom(a)} aria-pressed={on} className={tile(on)}>
                    <span className={tileIcon} aria-hidden="true">{/maison/i.test(a.label) ? "🏠" : "📌"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] font-semibold">{a.label}</span>
                      <span className="block truncate text-[13px] text-stone-500">{[a.quarter, a.landmark].filter(Boolean).join(" · ")}</span>
                    </span>
                    {on && <Icon name="check" className="h-5 w-5 shrink-0 text-emerald-700" />}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setPickupFromGps(false);
                  setPicker("pickup");
                }}
                className="px-1 text-[15px] font-semibold text-emerald-700"
              >
                {t("Autre endroit : choisir sur la carte")}
              </button>
              {locating === "error" && <p className="text-sm text-red-700">{t("Position indisponible. Autorisez la localisation, ou choisissez le point sur la carte.")}</p>}
            </div>
            {areaField("pickupAddress", t("ex. Bè Kpota, maison bleue"), `${t("Adresse de retrait et repère")}${pickupPos ? ` ${t("(facultatif)")}` : ""}`)}
            <ZedSwitch current="parcel" compact />
          </>
        )}

        {step === 1 && (
          <>
            <div className={`${card} space-y-3 p-4`}>
              {textField("recipientName", { autoComplete: "off" })}
              {textField("recipientPhone", { type: "tel", inputMode: "tel", placeholder: t("ex. 91 00 00 00") })}
            </div>
            <div className={`${card} p-4`}>
              {senderKnown ? (
                <div className="flex items-center gap-3">
                  <span className={tileIcon} aria-hidden="true">👤</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-stone-500">{t("Expéditeur")}</span>
                    <span className="block truncate text-[16px] font-semibold">
                      {value("name").trim()} · {value("phone").trim()}
                    </span>
                  </span>
                  <button type="button" onClick={() => setEditSender(true)} className="shrink-0 text-[15px] font-semibold text-emerald-700">
                    {t("Changer")}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">{t("Vous, l'expéditeur")}</p>
                  {textField("name", { autoComplete: "name" })}
                  {textField("phone", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: t("ex. 90 00 00 00") })}
                </div>
              )}
            </div>
            <p className="flex items-start gap-2 rounded-[12px] bg-emerald-50 p-3 text-[14px] text-emerald-900">
              <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
              {t("Le destinataire est appelé par le livreur à l'arrivée. Pas besoin de compte.")}
            </p>
          </>
        )}

        {step === 2 && (
          <>
            {known && !dropPos && (
              <button type="button" onClick={useKnown} className={tile(false)}>
                <span className={tileIcon} aria-hidden="true">🕘</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold">{t("Reprendre cette adresse")}</span>
                  <span className="block truncate text-[13px] text-stone-500">
                    {t("Déjà livré à ce numéro")}
                    {known.name ? ` (${known.name})` : ""} : {known.address || (known.latitude !== null ? t("position enregistrée") : "")}
                  </span>
                </span>
              </button>
            )}
            <div id="colis-address" className="space-y-3">
              {(
                [
                  ["ask", "📲", "Le destinataire envoie sa position", "on lui envoie un lien (SMS, WhatsApp)"],
                  ["map", "🗺️", "Je le place sur la carte", "je connais l'endroit"],
                  ["link", "🔗", "Coller un lien Google Maps", "ou des coordonnées"],
                ] as const
              ).map(([m, emoji, title, hint]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    if (m === "map") setPicker("drop");
                  }}
                  aria-pressed={mode === m}
                  className={tile(mode === m, missing.includes("address"))}
                >
                  <span className={tileIcon} aria-hidden="true">{emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold">{t(title)}</span>
                    <span className="block text-[13px] text-stone-500">{t(hint)}</span>
                  </span>
                  {mode === m && <Icon name="check" className="h-5 w-5 shrink-0 text-emerald-700" />}
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
                  <button type="submit" disabled={!link.trim() || linkState === "loading"} className="shrink-0 rounded-xl bg-emerald-600 px-3 font-semibold text-white disabled:opacity-40">
                    {linkState === "loading" ? "…" : t("Vérifier")}
                  </button>
                </div>
                {linkState === "error" ? (
                  <p className="text-sm text-red-700">{t("Ce lien ne contient pas de position. Dans Google Maps, touchez le point, puis « Partager », et copiez le lien.")}</p>
                ) : (
                  <p className="text-xs text-stone-500">{t("Lien Google Maps (même court, maps.app.goo.gl) ou coordonnées « 6.13, 1.22 ».")}</p>
                )}
              </form>
            )}

            {mode === "ask" && !(dropPos && dropFrom === "recipient") && (
              <RecipientRequest senderName={value("name")} recipientName={value("recipientName")} request={request} onRequest={setRequest} onShared={onShared} />
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
            {areaField("address", t("ex. Adidogomé, près du rond-point"), `${t("Adresse et repère")}${dropPos || request ? ` ${t("(facultatif)")}` : ""}`)}
          </>
        )}

        {step === 3 && (
          <>
            <p className="-mt-2 text-[15px] text-stone-500">{t("Le livreur adapte son sac. Touchez votre type de colis.")}</p>
            <div id="colis-category" className="grid grid-cols-2 gap-3">
              {categories.map((c) => {
                const on = categoryId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => chooseCategory(c)}
                    aria-pressed={on}
                    className={`flex min-h-[140px] flex-col items-center justify-center gap-1 rounded-[18px] border-2 p-3 text-center transition active:scale-[0.97] ${on ? "border-emerald-600 bg-emerald-50" : missing.includes("category") ? "border-red-300 bg-red-50/60" : "border-transparent bg-surface"}`}
                  >
                    <span className="text-[40px]" aria-hidden="true">{emojiOf(c.name)}</span>
                    <span className="text-[16px] font-semibold leading-tight">{c.name}</span>
                    <span className="text-[12px] text-stone-500">{c.surcharge || c.perKgFee ? `+${fcfa(extraFee(c, defaultKg(c.name)))}` : t("sans supplément")}</span>
                  </button>
                );
              })}
            </div>
            {/* Supplément au poids : le poids exact compte pour le prix, avec une valeur déjà proposée. */}
            {category && category.perKgFee > 0 && (
              <fieldset id="colis-weight" className="anim-fade-up space-y-2">
                <Legend missing={missing.includes("weight")}>{t("Poids approximatif")}</Legend>
                <div className="flex flex-wrap gap-2">
                  {WEIGHTS.map((w) => (
                    <button
                      key={w.label}
                      type="button"
                      onClick={() => {
                        setWeight(w.kg);
                        setSize(sizeOf(w.kg));
                      }}
                      aria-pressed={weight === w.kg}
                      className={pill(weight === w.kg)}
                    >
                      {t(w.label)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <section className={`${card} divide-y divide-stone-200/70 px-4`}>
              <SummaryRow dot="bg-emerald-500" label={t("Départ")} value={pickupText} onEdit={() => go(0)} />
              <SummaryRow
                dot="bg-red-500"
                label={km !== null ? `${t("Arrivée")} · ${kmLabel(km)}` : t("Arrivée")}
                value={`${value("recipientName").trim()} · ${firstLine(value("address")) || (dropPos ? t("position reçue") : priceLater ? t("position demandée") : t("à préciser"))}`}
                onEdit={() => go(2)}
              />
              <SummaryRow emoji={category ? emojiOf(category.name) : "📦"} label={t("Colis")} value={`${category?.name ?? ""}${category && category.perKgFee > 0 && weight !== null ? ` · ${t(WEIGHTS.find((w) => w.kg === weight)?.label ?? "")}` : ""}`} onEdit={() => go(3)} />
            </section>

            <div className={`${card} space-y-3 p-4`}>
              <p className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">{t("Qui paie ?")}</p>
              <div role="radiogroup" aria-label={t("Qui paie ?")} className="flex gap-1 rounded-[12px] bg-stone-100 p-1">
                {(
                  [
                    ["SENDER", t("Moi, maintenant")],
                    ["RECIPIENT", t("Le destinataire, à la livraison")],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={payer === v} onClick={() => setPayer(v)} className={`flex-1 rounded-[8px] px-2 py-2 text-[14px] font-semibold ${payer === v ? "bg-surface shadow-sm" : "text-stone-600"}`}>
                    {l}
                  </button>
                ))}
              </div>
              {payer === "SENDER" && mobileMoney && (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setPaymentMethod("CASH")} aria-pressed={paymentMethod === "CASH"} className={chip(paymentMethod === "CASH")}>
                    {t("Espèces")}
                    <span className="block text-xs font-normal text-stone-500">{t("au livreur")}</span>
                  </button>
                  <button type="button" onClick={() => setPaymentMethod("MOBILE_MONEY")} aria-pressed={paymentMethod === "MOBILE_MONEY"} className={chip(paymentMethod === "MOBILE_MONEY")}>
                    {t("Mobile money")}
                    <span className="block text-xs font-normal text-stone-500">{t("T-Money ou Flooz")}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Quand le livreur passe : maintenant, ou à un jour et une heure choisis (jusqu'à 7 jours). */}
            <div className={`${card} space-y-3 p-4`} role="group" aria-label={t("Quand ?")}>
              <div role="radiogroup" aria-label={t("Quand ?")} className="flex gap-1 rounded-[12px] bg-stone-100 p-1">
                {[
                  { v: false, l: t("Maintenant") },
                  { v: true, l: t("Plus tard") },
                ].map((o) => (
                  <button key={String(o.v)} type="button" role="radio" aria-checked={later === o.v} onClick={() => setLater(o.v)} className={`flex-1 rounded-[8px] py-2 text-sm font-semibold ${later === o.v ? "bg-surface shadow-sm" : "text-stone-600"}`}>
                    {o.l}
                  </button>
                ))}
              </div>
              {later && (
                <>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                    {days.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setDay(d.value)}
                        aria-pressed={dayOk?.value === d.value}
                        className={`shrink-0 rounded-[10px] px-3 py-2 text-[13px] font-semibold ${dayOk?.value === d.value ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}
                      >
                        {t(d.label)}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-[15px] font-medium">{t("Heure")}</span>
                    <select value={timeOk} onChange={(e) => setTime(e.target.value)} className="rounded-[10px] bg-stone-100 px-3 py-2 text-[16px] font-semibold">
                      {(dayOk?.times ?? []).map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-[13px] text-stone-500">{t("Un livreur reçoit votre colis 30 minutes avant l'heure choisie et passe le récupérer à l'heure.")}</p>
                </>
              )}
            </div>

            {noteOpen ? (
              <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus aria-label={t("Instructions")} rows={2} placeholder={t("Instructions pour le livreur (facultatif)")} className={input} />
            ) : (
              <button type="button" onClick={() => setNoteOpen(true)} className="px-1 text-[15px] font-semibold text-emerald-700">
                + {t("Instructions pour le livreur")}
              </button>
            )}

            <dl className={`${card} space-y-1 p-4 text-sm`}>
              <div className="flex justify-between gap-2">
                <dt>
                  {t("Livraison")}
                  {zonePriced ? ` (${dropZone?.name})` : km !== null ? ` (${kmLabel(km)})` : ""}
                </dt>
                <dd className="shrink-0 tabular-nums">{priceLater ? t("à la réponse") : priceToConfirm ? `${fcfa(fee)} ${t("min.")}` : fcfa(fee)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t("Supplément colis")}</dt>
                <dd className="tabular-nums">{fcfa(extra)}</dd>
              </div>
              <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-semibold">
                <dt>{t("Total")}</dt>
                <dd className="tabular-nums">{priceLater ? t("à venir") : fcfa(total)}</dd>
              </div>
              {priceLater && <p className="pt-1 text-stone-500">{t("Le prix de livraison sera calculé sur la distance dès que le destinataire aura partagé sa position.")}</p>}
              {priceToConfirm && <p className="pt-1 text-stone-500">{t("Sans les deux positions, la livraison est au tarif minimum : Zedeka confirmera le prix d'après l'adresse.")}</p>}
            </dl>
            <p className="flex items-start gap-2 rounded-[12px] bg-emerald-50 p-3 text-[14px] text-emerald-900">
              <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {payer === "RECIPIENT" ? t("Vous ne payez rien : le destinataire règle à la livraison.") : paymentMethod === "CASH" ? t("Vous payez le livreur en espèces quand il récupère le colis.") : t("Vous payez par mobile money une fois le livreur trouvé.")}{" "}
                {cancellation && <CancellationNote {...cancellation} />}{" "}
                <Link href="/remboursement" target="_blank" className="underline">
                  {t("Annulation et remboursement")}
                </Link>
              </span>
            </p>
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </>
        )}
      </div>

      {picker && (
        <MapPicker
          title={picker === "pickup" ? "Point de retrait" : "Point de livraison"}
          initial={picker === "pickup" ? (pickupPos ?? here) : (dropPos ?? pickupPos)}
          onClose={() => setPicker(null)}
          onPick={(p) => {
            if (picker === "pickup") {
              setPickupPos(p);
              setPickupFromGps(false);
            } else setDrop(p, "map");
            setMissing((m) => m.filter((x) => x !== (picker === "pickup" ? "pickupAddress" : "address")));
            setPicker(null);
          }}
        />
      )}

      {/* Barre du bouton sur fond plein, jusqu'à la barre d'onglets. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md bg-gradient-to-t from-surface from-80% to-transparent px-4 pb-6 pt-6">
        <div className="space-y-2">
          {gapNote}
          {step === 3 && category && !category.perKgFee ? null : step < 4 ? (
            <button
              type="button"
              onClick={forward}
              disabled={closed}
              className="inline-flex w-full items-center justify-between rounded-2xl bg-emerald-600 px-5 py-4 text-[17px] font-semibold text-white shadow-[0_8px_24px_rgb(5_150_105/0.35)] transition active:scale-[0.98] disabled:opacity-40"
            >
              <span>{step === 0 ? t("C'est ici") : step === 3 ? t("Voir le récapitulatif") : t("Continuer")}</span>
              <Icon name="chevron" className="h-5 w-5" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={next}
                disabled={closed || submitting}
                className="sheen inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-[17px] font-semibold text-white shadow-[0_8px_24px_rgb(5_150_105/0.35)] transition active:scale-[0.98] disabled:opacity-40"
              >
                {label}
              </button>
              <TermsNotice action="envoyant" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Une ligne du récapitulatif : pastille (ou pictogramme), petit libellé, valeur en gras, « Modifier ».
function SummaryRow(p: { dot?: string; emoji?: string; label: string; value: string; onEdit: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 py-3">
      {p.emoji ? (
        <span className="w-4 shrink-0 text-center text-[18px]" aria-hidden="true">
          {p.emoji}
        </span>
      ) : (
        <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${p.dot} ring-4 ring-black/5`} aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-stone-500">{p.label}</span>
        <span className="block truncate text-[16px] font-semibold">{p.value}</span>
      </span>
      <button type="button" onClick={p.onEdit} className="shrink-0 text-[14px] font-semibold text-emerald-700">
        {t("Modifier")}
      </button>
    </div>
  );
}
