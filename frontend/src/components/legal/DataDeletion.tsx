"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";

// Demande d'effacement (ou d'accès, ou de rectification) pour tous ceux qui n'ont pas de bouton dans leur profil :
// livreurs, partenaires, destinataires de colis, commandes passées sans compte. Rien n'est envoyé d'ici : le message
// prêt à partir s'ouvre dans WhatsApp ou depuis le numéro de la personne.
const ROLES = ["Client", "Destinataire d'un colis", "Livreur", "Partenaire (restaurant, commerce)"] as const;
const REQUESTS = ["Effacer toutes mes données", "Recevoir une copie de mes données", "Corriger mes données"] as const;

export default function DataDeletion({ whatsapp }: { whatsapp: string | null }) {
  const t = useT();
  const [role, setRole] = useState<(typeof ROLES)[number]>(ROLES[0]);
  const [kind, setKind] = useState<(typeof REQUESTS)[number]>(REQUESTS[0]);
  const [phone, setPhone] = useState("");
  const [details, setDetails] = useState("");

  // Message en français : c'est l'équipe de Zedeka qui le lit.
  const message = [
    `Demande relative à mes données personnelles (loi n° 2019-014)`, // i18n-ignore
    `Demande : ${kind}`, // i18n-ignore
    `Je suis : ${role}`, // i18n-ignore
    `Numéro utilisé sur Zedeka : ${phone}`, // i18n-ignore
    details && `Précisions : ${details}`, // i18n-ignore
  ]
    .filter(Boolean)
    .join("\n");
  const ready = phone.replace(/\D/g, "").length >= 8;
  const field = "w-full rounded-xl border border-stone-300 bg-white px-3.5 py-3 outline-none focus:border-emerald-700 focus:ring-4 focus:ring-emerald-600/15";
  const button = "inline-flex flex-1 items-center justify-center rounded-2xl px-4 py-3.5 font-semibold disabled:opacity-50";

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-emerald-50 p-4 text-emerald-950">
        <h2 className="!mt-0">{t("Vous avez un compte client ?")}</h2>
        <p>
          {t("Ouvrez votre profil et touchez « Supprimer mon compte » : vos adresses sont effacées et vos commandes détachées de votre numéro, tout de suite.")}{" "}
          <Link href="/app/profil">{t("Aller au profil")}</Link>
        </p>
      </section>

      <section className="space-y-4">
        <h2>{t("Pour toute autre demande")}</h2>
        <p>{t("Livreurs, partenaires, destinataires de colis, commandes sans compte, ou pour obtenir une copie de vos données : remplissez ce formulaire, puis envoyez le message depuis votre numéro.")}</p>
        <fieldset className="space-y-2">
          <legend className="mb-1 font-medium">{t("Votre demande")}</legend>
          {REQUESTS.map((r) => (
            <label key={r} className="flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === r} onChange={() => setKind(r)} className="h-4 w-4 accent-emerald-700" />
              {t(r)}
            </label>
          ))}
        </fieldset>
        <label className="block space-y-1">
          <span className="font-medium">{t("Vous êtes")}</span>
          <select value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} className={field}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-medium">{t("Numéro utilisé sur Zedeka")}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required placeholder="90 12 34 56" className={field} />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">
            {t("Précisions")} <span className="font-normal text-stone-600">({t("facultatif")})</span>
          </span>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={500} className={field} />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          {whatsapp && (
            <button type="button" disabled={!ready} onClick={() => window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`, "_blank", "noopener")} className={`${button} bg-emerald-700 text-white`}>
              {t("Envoyer sur WhatsApp")}
            </button>
          )}
        </div>
        {!ready && <p className="text-sm text-stone-600">{t("Indiquez votre numéro pour préparer le message.")}</p>}
      </section>

      <section>
        <h2>{t("Ensuite")}</h2>
        <ul>
          <li>{t("Nous vérifions que la demande vient bien du titulaire du numéro, puis nous répondons dans un délai d'un mois au plus.")}</li>
          <li>{t("Sont effacés : compte, adresses, positions, coordonnées, dossier de candidature et fichiers envoyés.")}</li>
          <li>{t("Restent, sans lien avec votre numéro : les commandes et pièces comptables, que la loi oblige à garder 10 ans.")}</li>
          <li>{t("Si la réponse ne vous satisfait pas, vous pouvez saisir l'IPDCP (Instance de Protection des Données à Caractère Personnel).")}</li>
        </ul>
      </section>
    </div>
  );
}
