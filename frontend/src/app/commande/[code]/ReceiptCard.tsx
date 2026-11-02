"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { input, primary } from "@/app/app/ui";
import { answerReceipt, readReceipt, type Receipt } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

// Note de 1 à 5 étoiles.
function Stars({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const t = useT();
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-1 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={t("{n} sur 5", { n })}
            aria-pressed={value === n}
            className={`text-3xl leading-none transition ${n <= value ? "text-amber-400" : "text-stone-300"}`}
          >
            ★
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// Clôture de la livraison par le client : code à donner au livreur, puis « J'ai bien reçu » avec la note du
// livreur (obligatoire) et du restaurant (facultative), ou « Je n'ai rien reçu ».
export default function ReceiptCard({ code, stamp }: { code: string; stamp: string }) {
  const router = useRouter();
  const t = useT();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [driverRating, setDriverRating] = useState(0);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [comment, setComment] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"thanks" | "dispute" | null>(null);

  useEffect(() => {
    readReceipt(code).then(setReceipt).catch(() => setReceipt(null));
  }, [code, stamp]);

  async function send(answer: Parameters<typeof answerReceipt>[1]) {
    setBusy(true);
    setError(null);
    try {
      await answerReceipt(code, answer);
      setSent(answer.received ? "thanks" : "dispute");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <section className="rounded-[20px] bg-emerald-50 p-5 text-emerald-950">
        <p className="font-semibold">{sent === "thanks" ? t("Merci, livraison clôturée.") : t("Signalement transmis")}</p>
        <p className="text-sm">{sent === "thanks" ? t("Votre note aide Zedeka à garder les meilleurs livreurs et restaurants.") : t("Zedeka vérifie avec le livreur et vous rappelle.")}</p>
      </section>
    );
  if (!receipt) return null;

  // Commande en route : code à donner au livreur à la remise.
  if (!receipt.state)
    return receipt.deliveryCode ? (
      <section className="flex items-center gap-4 rounded-[20px] bg-white p-5">
        <span className="flex-1">
          <span className="block font-semibold">{t("Code de livraison")}</span>
          <span className="block text-sm text-stone-500">{t("Donnez ce code au livreur quand vous recevez la commande.")}</span>
        </span>
        <span className="font-mono text-3xl font-bold tracking-[0.2em] text-emerald-700">{receipt.deliveryCode}</span>
      </section>
    ) : null;

  if (receipt.state === "DISPUTED")
    return (
      <section className="rounded-[20px] bg-amber-50 p-5 text-amber-950">
        <p className="font-semibold">{t("Signalement transmis")}</p>
        <p className="text-sm">{t("Zedeka vérifie avec le livreur et vous rappelle.")}</p>
      </section>
    );

  if (!receipt.allowed)
    return (
      <section className="rounded-[20px] bg-white p-5 text-sm text-stone-600">
        {t("Connectez-vous avec le compte qui a passé la commande pour confirmer la réception.")}
      </section>
    );

  const confirming = receipt.state === "CONFIRM";
  const driver = receipt.driverFirstName ?? t("le livreur");
  return (
    <section className="space-y-4 rounded-[20px] bg-white p-5 ring-2 ring-emerald-600">
      <div>
        <h2 className="text-[19px] font-bold">{confirming ? t("Avez-vous reçu votre commande ?") : t("Notez votre livraison")}</h2>
        <p className="text-sm text-stone-500">
          {confirming ? t("{name} indique vous l'avoir remise. Confirmez pour clôturer la livraison.", { name: driver }) : t("Votre avis sur {name} et la livraison.", { name: driver })}
        </p>
      </div>
      {confirming && receipt.deliveryCode && (
        <p className="text-sm text-stone-600">
          {t("Ou donnez ce code au livreur :")} <strong className="font-mono text-lg tracking-[0.2em] text-emerald-700">{receipt.deliveryCode}</strong>
        </p>
      )}
      {disputing ? (
        <>
          <label className="block text-sm font-medium">
            {t("Que s'est-il passé ?")}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder={t("Ex. personne n'est venu, il manque un plat")} className={`${input} mt-1`} />
          </label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button disabled={busy || note.trim().length < 3} onClick={() => send({ received: false, note })} className="inline-flex w-full items-center justify-center rounded-2xl bg-red-600 px-4 py-3.5 font-semibold text-white disabled:opacity-40">
            {t("Prévenir Zedeka")}
          </button>
          <button onClick={() => setDisputing(false)} className="w-full py-1 text-center text-sm font-medium text-stone-600">
            {t("Retour")}
          </button>
        </>
      ) : (
        <>
          <Stars label={t("Note du livreur")} value={driverRating} onChange={setDriverRating} />
          {receipt.restaurantName && <Stars label={t("Note de {name} (facultatif)", { name: receipt.restaurantName })} value={restaurantRating} onChange={setRestaurantRating} />}
          <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder={t("Un commentaire ? (facultatif)")} aria-label={t("Commentaire")} className={input} />
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button
            disabled={busy || !driverRating}
            onClick={() => send({ received: true, driverRating, ...(restaurantRating ? { restaurantRating } : {}), ...(comment.trim() ? { comment } : {}) })}
            className={primary}
          >
            {confirming ? t("J'ai bien reçu ma commande") : t("Envoyer ma note")}
          </button>
          {!driverRating && <p className="text-center text-xs text-stone-500">{t("Choisissez une note pour le livreur.")}</p>}
          {confirming && (
            <button onClick={() => setDisputing(true)} className="w-full py-1 text-center text-sm font-medium text-red-700">
              {t("Je n'ai rien reçu")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
