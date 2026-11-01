"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { field } from "@/components/ContactFields";
import TermsConsent from "@/components/legal/TermsConsent";
import PinField from "@/components/PinField";
import { apiGet, apiPost, type Zone } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

export default function DriverApplyPage() {
  const t = useT();
  const [zones, setZones] = useState<Zone[]>([]);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Zone[]>("/api/zones").then((z) => setZones(z ?? [])).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("pin") !== f.get("pin2")) {
      setError(t("Les deux codes PIN ne sont pas identiques"));
      return;
    }
    setError(null);
    try {
      await apiPost("/api/drivers/apply", {
        name: f.get("name"),
        phone: f.get("phone"),
        vehicle: f.get("vehicle"),
        zoneId: f.get("zoneId") || undefined,
        pin: f.get("pin"),
        email: f.get("email") || undefined,
        acceptTerms: f.get("acceptTerms") === "on",
      });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold">{t("Candidature envoyée")}</h1>
        <p className="mt-2 text-stone-700">{t("Merci ! L'équipe Zedeka vous appelle pour un entretien.")}</p>
        <p className="mt-2 text-sm text-stone-600">
          {t("Connectez-vous avec votre numéro et votre code PIN pour suivre votre candidature, puis recevoir vos courses, dans")}{" "}
          <Link href="/livreur/connexion" className="font-medium text-emerald-700 underline">
            {t("l'application livreur")}
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
      <h1 className="text-xl font-semibold">{t("Devenir livreur Zedeka")}</h1>
      <input name="name" required minLength={2} autoComplete="name" placeholder={t("Nom complet")} aria-label={t("Nom complet")} className={field} />
      <input name="phone" required type="tel" autoComplete="tel" pattern="\+?[0-9 ]{8,15}" placeholder={t("Téléphone")} aria-label={t("Téléphone")} className={field} />
      <input name="email" type="email" autoComplete="email" placeholder={t("E-mail (facultatif)")} aria-label={t("E-mail (facultatif)")} className={field} />
      <select name="vehicle" aria-label={t("Véhicule")} className={field} defaultValue="MOTO">
        <option value="MOTO">{t("Moto")}</option>
        <option value="VELO">{t("Vélo")}</option>
        <option value="VOITURE">{t("Voiture")}</option>
      </select>
      <select name="zoneId" aria-label={t("Zone souhaitée (facultatif)")} className={field} defaultValue="">
        <option value="">{t("Zone souhaitée (facultatif)")}</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </select>
      <PinField name="pin" label={t("Choisissez un code PIN")} hint={t("4 chiffres")} />
      <PinField name="pin2" label={t("Confirmez le code PIN")} />
      <p className="text-xs text-stone-600">{t("Avec votre numéro ou votre e-mail, il vous servira à vous connecter à l'application livreur. Évitez 1234, 0000 ou votre année de naissance.")}</p>
      <TermsConsent terms={{ href: "/conditions-livreurs", label: "conditions livreurs" }} />
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white">{t("Envoyer ma candidature")}</button>
    </form>
  );
}
