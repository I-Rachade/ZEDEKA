"use client";

// i18n-ignore-file : textes de cette page dans les deux langues ci-dessous (T.fr, T.en).

import Link from "next/link";
import { useEffect, useState } from "react";
import { card, input, primary, secondary } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { LANG_COOKIE } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

type Request = { senderFirstName: string; kind?: "FOOD" | "PARCEL"; status: "OPENED" | "SHARED" | "DECLINED"; expiresAt: string };
type Found = { latitude: number; longitude: number; accuracy: number };

// Au-delà, on propose de réessayer dehors ou d'ajouter un repère.
const ROUGH_M = 150;
// Textes de la page, en français et en anglais : le destinataire choisit sa langue (bouton FR / EN de l'en-tête).
const T = {
  fr: {
    loading: "Chargement…",
    goneTitle: "Ce lien n'est plus valable",
    goneText: "Il a expiré, a été remplacé, ou le colis est déjà en route. Contactez la personne qui vous envoie le colis.",
    sentTitle: "Position envoyée, merci",
    receivedTitle: "Votre position a bien été reçue",
    declinedTitle: "C'est noté, merci",
    sentText: "Le livreur viendra à ce point pour cette livraison. Il vous appellera s'il ne vous trouve pas.",
    declinedText: "La personne qui vous envoie le colis indiquera le point de livraison.",
    shareAfterAll: "Finalement, partager ma position",
    useApp: "Pour vos prochaines livraisons de colis et pour commander à manger, utilisez l'application Zedeka. À bientôt !",
    home: "Aller à l'accueil",
    declineTitle: "Sans position, pas de souci",
    declineText: "La personne qui vous envoie le colis placera le point de livraison. Un repère peut l'aider.",
    send: "Envoyer",
    sending: "Envoi…",
    back: "Revenir en arrière",
    rough: "Position approximative",
    found: "Position trouvée",
    within: (m: number) => `à ${m} m près`,
    weakGps: "Le signal GPS est faible. Réessayez dehors pour plus de précision, ou envoyez quand même avec un repère.",
    sendAnyway: "Envoyer quand même",
    sendPosition: "Envoyer ma position",
    retryPosition: "Réessayer la position",
    deniedTitle: "Position non disponible",
    deniedText: "Votre téléphone n'a pas donné la position. Pour l'autoriser :",
    deniedTips: [
      "Activez la localisation (GPS) du téléphone.",
      "Android : touchez le cadenas à côté de l'adresse, puis Autorisations, Position.",
      "iPhone : Réglages, Confidentialité, Service de localisation, puis votre navigateur.",
    ],
    retry: "Réessayer",
    continueWithout: "Continuer sans position",
    title: (name: string) => (name ? `${name} vous envoie un colis` : "Un colis arrive pour vous"),
    intro: "Partagez votre position pour que le livreur Zedeka vous trouve facilement.",
    privacy: ["Seuls le livreur et Zedeka la verront, pour cette livraison.", "Elle est prise une seule fois, vous n'êtes pas suivi.", "Elle est effacée 30 jours après la livraison."],
    locating: "Recherche de votre position…",
    share: "Partager ma position",
    noThanks: "Non merci",
    landmarkLabel: "Repère pour le livreur (facultatif)",
    landmarkPlaceholder: "ex. portail vert, après la boutique",
    failed: "L'envoi n'a pas abouti. Vérifiez votre connexion et réessayez.",
  },
  en: {
    loading: "Loading…",
    goneTitle: "This link is no longer valid",
    goneText: "It has expired, been replaced, or the parcel is already on its way. Please contact the person sending you the parcel.",
    sentTitle: "Location sent, thank you",
    receivedTitle: "Your location has been received",
    declinedTitle: "Got it, thank you",
    sentText: "The courier will come to this spot for this delivery. They will call you if they can't find you.",
    declinedText: "The person sending you the parcel will set the delivery point.",
    shareAfterAll: "Share my location after all",
    useApp: "For your next parcel deliveries and to order food, use the Zedeka app. See you soon!",
    home: "Go to the home page",
    declineTitle: "No location, no problem",
    declineText: "The person sending you the parcel will set the delivery point. A landmark can help them.",
    send: "Send",
    sending: "Sending…",
    back: "Go back",
    rough: "Approximate location",
    found: "Location found",
    within: (m: number) => `accurate to ${m} m`,
    weakGps: "The GPS signal is weak. Try again outside for better accuracy, or send it anyway with a landmark.",
    sendAnyway: "Send anyway",
    sendPosition: "Send my location",
    retryPosition: "Try the location again",
    deniedTitle: "Location unavailable",
    deniedText: "Your phone did not provide your location. To allow it:",
    deniedTips: [
      "Turn on your phone's location (GPS).",
      "Android: tap the padlock next to the address, then Permissions, Location.",
      "iPhone: Settings, Privacy, Location Services, then your browser.",
    ],
    retry: "Try again",
    continueWithout: "Continue without location",
    title: (name: string) => (name ? `${name} is sending you a parcel` : "A parcel is on its way to you"),
    intro: "Share your location so the Zedeka courier can find you easily.",
    privacy: ["Only the courier and Zedeka will see it, for this delivery.", "It is taken once only; you are not tracked.", "It is deleted 30 days after delivery."],
    locating: "Finding your location…",
    share: "Share my location",
    noThanks: "No thanks",
    landmarkLabel: "Landmark for the courier (optional)",
    landmarkPlaceholder: "e.g. green gate, after the shop",
    failed: "Sending failed. Check your connection and try again.",
  },
} satisfies Record<"fr" | "en", unknown>;

// Repas commandé pour quelqu'un d'autre : mêmes écrans, textes du repas à la place de ceux du colis.
const FOOD = {
  fr: {
    title: (name: string) => (name ? `${name} vous fait livrer un repas` : "Un repas arrive pour vous"),
    declinedText: "La personne qui vous fait livrer le repas indiquera le point de livraison.",
    declineText: "La personne qui vous fait livrer le repas placera le point de livraison. Un repère peut l'aider.",
  },
  en: {
    title: (name: string) => (name ? `${name} is having a meal delivered to you` : "A meal is on its way to you"),
    declinedText: "The person ordering the meal for you will set the delivery point.",
    declineText: "The person ordering the meal for you will set the delivery point. A landmark can help them.",
  },
};

// Parcours du destinataire : accord, position prise une seule fois, repère facultatif, envoi. Ou refus.
export default function PositionShare({ token }: { token: string }) {
  const { lang, setLang } = useI18n();
  const [req, setReq] = useState<Request | null>(null);
  const [step, setStep] = useState<"loading" | "gone" | "consent" | "locating" | "found" | "denied" | "decline" | "sent" | "received" | "declined">("loading");
  const [found, setFound] = useState<Found | null>(null);
  const [landmark, setLandmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/position/${encodeURIComponent(token)}`;
  const t = req?.kind === "FOOD" ? { ...T[lang], ...FOOD[lang] } : T[lang];

  // Sans langue choisie sur le site, celle du téléphone.
  useEffect(() => {
    const chosen = document.cookie.split("; ").some((c) => c.startsWith(`${LANG_COOKIE}=`));
    if (!chosen && navigator.language?.toLowerCase().startsWith("en")) setLang("en");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois, à l'ouverture du lien
  }, []);

  useEffect(() => {
    fetch(path, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return setStep("gone");
        const r = (await res.json()) as Request;
        setReq(r);
        // Position déjà reçue pour cette livraison : plus rien à envoyer.
        setStep(r.status === "SHARED" ? "received" : "consent");
      })
      .catch(() => setStep("gone"));
  }, [path]);


  function locate() {
    setError(null);
    if (!("geolocation" in navigator)) return setStep("denied");
    setStep("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setFound({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy });
        setStep("found");
      },
      () => setStep("denied"),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  // Envoi au serveur : 409 = position déjà reçue (autre onglet), 404 = lien plus valable.
  async function post(url: string, payload: unknown, done: "sent" | "declined") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) setStep(done);
      else if (res.status === 409) setStep("received");
      else if (res.status === 404) setStep("gone");
      else setError(t.failed);
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  }

  const send = () => found && post(path, { ...found, landmark: landmark.trim() || undefined, consent: true }, "sent");
  const decline = () => post(`${path}/decline`, { landmark: landmark.trim() || undefined }, "declined");

  const landmarkField = (
    <label className="block space-y-1">
      <span className="text-sm text-stone-600">{t.landmarkLabel}</span>
      <input value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={200} placeholder={t.landmarkPlaceholder} className={input} />
    </label>
  );
  const errorLine = error && (
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
      {error}
    </p>
  );

  return (
    <div className="space-y-3">{screen()}</div>
  );

  function screen() {
    if (step === "loading") return <p className="py-10 text-center text-stone-500">{t.loading}</p>;

    if (step === "gone")
      return (
        <section className={`${card} space-y-2 p-6 text-center`}>
          <h1 className="text-xl font-semibold">{t.goneTitle}</h1>
          <p className="text-[15px] text-stone-600">{t.goneText}</p>
        </section>
      );

    // Fin du parcours : plus de bouton de partage une fois la position reçue, seulement l'accueil.
    if (step === "sent" || step === "received" || step === "declined")
      return (
        <section className={`${card} space-y-4 p-6 text-center`}>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-600/10 text-emerald-600">
            <Icon name="check" className="h-6 w-6" />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">{step === "sent" ? t.sentTitle : step === "received" ? t.receivedTitle : t.declinedTitle}</h1>
            <p className="text-[15px] text-stone-600">{step === "declined" ? t.declinedText : t.sentText}</p>
          </div>
          {step === "declined" && (
            <button type="button" onClick={() => setStep("consent")} className="text-sm text-emerald-700 underline">
              {t.shareAfterAll}
            </button>
          )}
          <p className="rounded-xl bg-emerald-600/5 p-4 text-[15px] text-emerald-900">{t.useApp}</p>
          <Link href="/" className={primary}>
            {t.home}
          </Link>
        </section>
      );

    if (step === "decline")
      return (
        <section className={`${card} space-y-4 p-5`}>
          <h1 className="text-xl font-semibold">{t.declineTitle}</h1>
          <p className="text-[15px] text-stone-600">{t.declineText}</p>
          {landmarkField}
          {errorLine}
          <button type="button" onClick={decline} disabled={busy} className={primary}>
            {busy ? t.sending : t.send}
          </button>
          <button type="button" onClick={() => setStep("consent")} className="w-full text-sm text-emerald-700 underline">
            {t.back}
          </button>
        </section>
      );

    if (step === "found" && found) {
      const rough = found.accuracy > ROUGH_M;
      return (
        <section className={`${card} space-y-4 p-5`}>
          <div className="text-center">
            <h1 className="text-xl font-semibold">{rough ? t.rough : t.found}</h1>
            <p className="text-[15px] text-stone-500">{t.within(Math.round(found.accuracy))}</p>
          </div>
          {rough && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t.weakGps}</p>}
          {landmarkField}
          {errorLine}
          <button type="button" onClick={send} disabled={busy} className={primary}>
            {busy ? t.sending : rough ? t.sendAnyway : t.sendPosition}
          </button>
          <button type="button" onClick={locate} className={secondary}>
            {t.retryPosition}
          </button>
        </section>
      );
    }

    if (step === "denied")
      return (
        <section className={`${card} space-y-4 p-5`}>
          <h1 className="text-xl font-semibold">{t.deniedTitle}</h1>
          <p className="text-[15px] text-stone-600">{t.deniedText}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
            {t.deniedTips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          <button type="button" onClick={locate} className={primary}>
            {t.retry}
          </button>
          <button type="button" onClick={() => setStep("decline")} className={secondary}>
            {t.continueWithout}
          </button>
        </section>
      );

    // Accord, avant toute demande au téléphone.
    return (
      <section className={`${card} space-y-5 p-5`}>
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold leading-tight">{t.title(req?.senderFirstName ?? "")}</h1>
          <p className="text-[15px] text-stone-600">{t.intro}</p>
        </div>
        <ul className="space-y-2 rounded-xl bg-stone-100 p-4 text-sm text-stone-700">
          {t.privacy.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <button type="button" onClick={locate} disabled={step === "locating"} className={primary}>
          {step === "locating" ? t.locating : t.share}
        </button>
        <button type="button" onClick={() => setStep("decline")} disabled={step === "locating"} className={secondary}>
          {t.noThanks}
        </button>
      </section>
    );
  }
}
