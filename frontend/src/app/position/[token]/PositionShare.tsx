"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { card, input, primary, secondary } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { apiPost } from "@/lib/api";

type Request = { senderFirstName: string; status: "OPENED" | "SHARED" | "DECLINED"; expiresAt: string };
type Found = { latitude: number; longitude: number; accuracy: number };

// Au-delà, on propose de réessayer dehors ou d'ajouter un repère.
const ROUGH_M = 150;

// Parcours du destinataire : accord, position prise une seule fois, repère facultatif, envoi. Ou refus.
export default function PositionShare({ token }: { token: string }) {
  const [req, setReq] = useState<Request | null>(null);
  const [step, setStep] = useState<"loading" | "gone" | "consent" | "locating" | "found" | "denied" | "decline" | "sent" | "received" | "declined">("loading");
  const [found, setFound] = useState<Found | null>(null);
  const [landmark, setLandmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/position/${encodeURIComponent(token)}`;

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

  // Refus du serveur : si la position est arrivée entre-temps (autre onglet), on montre l'écran final.
  async function fail(e: unknown) {
    const res = await fetch(path, { cache: "no-store" }).catch(() => null);
    const r = res?.ok ? ((await res.json()) as Request) : null;
    if (r?.status === "SHARED") return setStep("received");
    setError((e as Error).message);
  }

  async function send() {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(path, { ...found, landmark: landmark.trim() || undefined, consent: true });
      setStep("sent");
    } catch (e) {
      await fail(e);
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
      await fail(e);
    } finally {
      setBusy(false);
    }
  }

  const landmarkField = (
    <label className="block space-y-1">
      <span className="text-sm text-stone-600">Repère pour le livreur (facultatif)</span>
      <input value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={200} placeholder="ex. portail vert, après la boutique" className={input} />
    </label>
  );
  const errorLine = error && (
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
      {error}
    </p>
  );

  if (step === "loading") return <p className="py-10 text-center text-stone-500">Chargement…</p>;

  if (step === "gone")
    return (
      <section className={`${card} space-y-2 p-6 text-center`}>
        <h1 className="text-xl font-semibold">Ce lien n&apos;est plus valable</h1>
        <p className="text-[15px] text-stone-600">Il a expiré, a été remplacé, ou le colis est déjà en route. Contactez la personne qui vous envoie le colis.</p>
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
          <h1 className="text-xl font-semibold">{step === "sent" ? "Position envoyée, merci" : step === "received" ? "Votre position a bien été reçue" : "C'est noté, merci"}</h1>
          <p className="text-[15px] text-stone-600">
            {step === "declined"
              ? "La personne qui vous envoie le colis indiquera le point de livraison."
              : "Le livreur viendra à ce point pour cette livraison. Il vous appellera s'il ne vous trouve pas."}
          </p>
        </div>
        {step === "declined" && (
          <button type="button" onClick={() => setStep("consent")} className="text-sm text-emerald-700 underline">
            Finalement, partager ma position
          </button>
        )}
        <p className="rounded-xl bg-emerald-600/5 p-4 text-[15px] text-emerald-900">
          Pour vos prochaines livraisons de colis et pour commander à manger, utilisez l&apos;application Zedeka. À bientôt !
        </p>
        <Link href="/" className={primary}>
          Aller à l&apos;accueil
        </Link>
      </section>
    );

  if (step === "decline")
    return (
      <section className={`${card} space-y-4 p-5`}>
        <h1 className="text-xl font-semibold">Sans position, pas de souci</h1>
        <p className="text-[15px] text-stone-600">La personne qui vous envoie le colis placera le point de livraison. Un repère peut l&apos;aider.</p>
        {landmarkField}
        {errorLine}
        <button type="button" onClick={decline} disabled={busy} className={primary}>
          {busy ? "Envoi…" : "Envoyer"}
        </button>
        <button type="button" onClick={() => setStep("consent")} className="w-full text-sm text-emerald-700 underline">
          Revenir en arrière
        </button>
      </section>
    );

  if (step === "found" && found) {
    const rough = found.accuracy > ROUGH_M;
    return (
      <section className={`${card} space-y-4 p-5`}>
        <div className="text-center">
          <h1 className="text-xl font-semibold">{rough ? "Position approximative" : "Position trouvée"}</h1>
          <p className="text-[15px] text-stone-500">à {Math.round(found.accuracy)} m près</p>
        </div>
        {rough && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Le signal GPS est faible. Réessayez dehors pour plus de précision, ou envoyez quand même avec un repère.
          </p>
        )}
        {landmarkField}
        {errorLine}
        <button type="button" onClick={send} disabled={busy} className={primary}>
          {busy ? "Envoi…" : rough ? "Envoyer quand même" : "Envoyer ma position"}
        </button>
        <button type="button" onClick={locate} className={secondary}>
          Réessayer la position
        </button>
      </section>
    );
  }

  if (step === "denied")
    return (
      <section className={`${card} space-y-4 p-5`}>
        <h1 className="text-xl font-semibold">Position non disponible</h1>
        <p className="text-[15px] text-stone-600">Votre téléphone n&apos;a pas donné la position. Pour l&apos;autoriser :</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
          <li>Activez la localisation (GPS) du téléphone.</li>
          <li>Android : touchez le cadenas à côté de l&apos;adresse, puis Autorisations, Position.</li>
          <li>iPhone : Réglages, Confidentialité, Service de localisation, puis votre navigateur.</li>
        </ul>
        <button type="button" onClick={locate} className={primary}>
          Réessayer
        </button>
        <button type="button" onClick={() => setStep("decline")} className={secondary}>
          Continuer sans position
        </button>
      </section>
    );

  // Accord, avant toute demande au téléphone.
  return (
    <section className={`${card} space-y-5 p-5`}>
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold leading-tight">{req?.senderFirstName ? `${req.senderFirstName} vous envoie un colis` : "Un colis arrive pour vous"}</h1>
        <p className="text-[15px] text-stone-600">Partagez votre position pour que le livreur Zedeka vous trouve facilement.</p>
      </div>
      <ul className="space-y-2 rounded-xl bg-stone-100 p-4 text-sm text-stone-700">
        <li>Seuls le livreur et Zedeka la verront, pour cette livraison.</li>
        <li>Elle est prise une seule fois, vous n&apos;êtes pas suivi.</li>
        <li>Elle est effacée 30 jours après la livraison.</li>
      </ul>
      <button type="button" onClick={locate} disabled={step === "locating"} className={primary}>
        {step === "locating" ? "Recherche de votre position…" : "Partager ma position"}
      </button>
      <button type="button" onClick={() => setStep("decline")} disabled={step === "locating"} className={secondary}>
        Non merci
      </button>
    </section>
  );
}
