"use client";

import { useEffect, useState } from "react";
import { card, input, primary, secondary } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { apiPost } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

type Request = { senderFirstName: string; status: "OPENED" | "SHARED" | "DECLINED"; expiresAt: string };
type Found = { latitude: number; longitude: number; accuracy: number };

// Au-delà, on propose de réessayer dehors ou d'ajouter un repère.
const ROUGH_M = 150;

// Parcours du destinataire : accord, position prise une seule fois, repère facultatif, envoi. Ou refus.
export default function PositionShare({ token }: { token: string }) {
  const [req, setReq] = useState<Request | null>(null);
  const [step, setStep] = useState<"loading" | "gone" | "consent" | "locating" | "found" | "denied" | "decline" | "sent" | "declined">("loading");
  const [found, setFound] = useState<Found | null>(null);
  const [landmark, setLandmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const path = `/api/position/${encodeURIComponent(token)}`;

  useEffect(() => {
    fetch(path, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return setStep("gone");
        setReq((await res.json()) as Request);
        setStep("consent");
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

  async function send() {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(path, { ...found, landmark: landmark.trim() || undefined, consent: true });
      setStep("sent");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`${path}/decline`, { landmark: landmark.trim() || undefined });
      setStep("declined");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const landmarkField = (
    <label className="block space-y-1">
      <span className="text-sm text-stone-600">{t("Repère pour le livreur (facultatif)")}</span>
      <input value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={200} placeholder={t("ex. portail vert, après la boutique")} className={input} />
    </label>
  );
  const errorLine = error && (
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
      {error}
    </p>
  );

  if (step === "loading") return <p className="py-10 text-center text-stone-500">{t("Chargement…")}</p>;

  if (step === "gone")
    return (
      <section className={`${card} space-y-2 p-6 text-center`}>
        <h1 className="text-xl font-semibold">{t("Ce lien n'est plus valable")}</h1>
        <p className="text-[15px] text-stone-600">{t("Il a expiré, a été remplacé, ou le colis est déjà en route. Contactez la personne qui vous envoie le colis.")}</p>
      </section>
    );

  if (step === "sent" || step === "declined")
    return (
      <section className={`${card} space-y-3 p-6 text-center`}>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-600/10 text-emerald-600">
          <Icon name="check" className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-semibold">{step === "sent" ? t("Position envoyée, merci") : t("C'est noté, merci")}</h1>
        <p className="text-[15px] text-stone-600">
          {step === "sent"
            ? t("Le livreur viendra à ce point. Il vous appellera s'il ne vous trouve pas.")
            : t("La personne qui vous envoie le colis indiquera le point de livraison.")}
        </p>
        {step === "declined" && (
          <button type="button" onClick={() => setStep("consent")} className="text-sm text-emerald-700 underline">
            {t("Finalement, partager ma position")}
          </button>
        )}
      </section>
    );

  if (step === "decline")
    return (
      <section className={`${card} space-y-4 p-5`}>
        <h1 className="text-xl font-semibold">{t("Sans position, pas de souci")}</h1>
        <p className="text-[15px] text-stone-600">{t("La personne qui vous envoie le colis placera le point de livraison. Un repère peut l'aider.")}</p>
        {landmarkField}
        {errorLine}
        <button type="button" onClick={decline} disabled={busy} className={primary}>
          {busy ? t("Envoi…") : t("Envoyer")}
        </button>
        <button type="button" onClick={() => setStep("consent")} className="w-full text-sm text-emerald-700 underline">
          {t("Revenir en arrière")}
        </button>
      </section>
    );

  if (step === "found" && found) {
    const rough = found.accuracy > ROUGH_M;
    return (
      <section className={`${card} space-y-4 p-5`}>
        <div className="text-center">
          <h1 className="text-xl font-semibold">{rough ? t("Position approximative") : t("Position trouvée")}</h1>
          <p className="text-[15px] text-stone-500">{t("à {n} m près", { n: Math.round(found.accuracy) })}</p>
        </div>
        {rough && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {t("Le signal GPS est faible. Réessayez dehors pour plus de précision, ou envoyez quand même avec un repère.")}
          </p>
        )}
        {landmarkField}
        {errorLine}
        <button type="button" onClick={send} disabled={busy} className={primary}>
          {busy ? t("Envoi…") : rough ? t("Envoyer quand même") : t("Envoyer ma position")}
        </button>
        <button type="button" onClick={locate} className={secondary}>
          {t("Réessayer la position")}
        </button>
      </section>
    );
  }

  if (step === "denied")
    return (
      <section className={`${card} space-y-4 p-5`}>
        <h1 className="text-xl font-semibold">{t("Position non disponible")}</h1>
        <p className="text-[15px] text-stone-600">{t("Votre téléphone n'a pas donné la position. Pour l'autoriser :")}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
          <li>{t("Activez la localisation (GPS) du téléphone.")}</li>
          <li>{t("Android : touchez le cadenas à côté de l'adresse, puis Autorisations, Position.")}</li>
          <li>{t("iPhone : Réglages, Confidentialité, Service de localisation, puis votre navigateur.")}</li>
        </ul>
        <button type="button" onClick={locate} className={primary}>
          {t("Réessayer")}
        </button>
        <button type="button" onClick={() => setStep("decline")} className={secondary}>
          {t("Continuer sans position")}
        </button>
      </section>
    );

  // Accord, avant toute demande au téléphone.
  return (
    <section className={`${card} space-y-5 p-5`}>
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold leading-tight">{req?.senderFirstName ? t("{name} vous envoie un colis", { name: req.senderFirstName }) : t("Un colis arrive pour vous")}</h1>
        <p className="text-[15px] text-stone-600">{t("Partagez votre position pour que le livreur Zedeka vous trouve facilement.")}</p>
      </div>
      {req?.status === "SHARED" && <p className="rounded-xl bg-emerald-600/5 p-3 text-sm text-emerald-800">{t("Votre position a déjà été reçue. Vous pouvez l'envoyer à nouveau pour la corriger.")}</p>}
      <ul className="space-y-2 rounded-xl bg-stone-100 p-4 text-sm text-stone-700">
        <li>{t("Seuls le livreur et Zedeka la verront, pour cette livraison.")}</li>
        <li>{t("Elle est prise une seule fois, vous n'êtes pas suivi.")}</li>
        <li>{t("Elle est effacée 30 jours après la livraison.")}</li>
      </ul>
      <button type="button" onClick={locate} disabled={step === "locating"} className={primary}>
        {step === "locating" ? t("Recherche de votre position…") : t("Partager ma position")}
      </button>
      <button type="button" onClick={() => setStep("decline")} disabled={step === "locating"} className={secondary}>
        {t("Non merci")}
      </button>
    </section>
  );
}
