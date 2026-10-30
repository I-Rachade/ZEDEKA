"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { field } from "@/components/ContactFields";
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
    try {
      await apiPost("/api/drivers/apply", {
        name: f.get("name"),
        phone: f.get("phone"),
        vehicle: f.get("vehicle"),
        zoneId: f.get("zoneId") || undefined,
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
          {t("Suivez votre candidature, puis recevez vos courses, dans")}{" "}
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
      <input name="name" required minLength={2} placeholder={t("Nom complet")} className={field} />
      <input name="phone" required type="tel" pattern="\+?[0-9 ]{8,15}" placeholder={t("Téléphone")} className={field} />
      <select name="vehicle" className={field} defaultValue="MOTO">
        <option value="MOTO">{t("Moto")}</option>
        <option value="VELO">{t("Vélo")}</option>
        <option value="VOITURE">{t("Voiture")}</option>
      </select>
      <select name="zoneId" className={field} defaultValue="">
        <option value="">{t("Zone souhaitée (facultatif)")}</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </select>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white">{t("Envoyer ma candidature")}</button>
    </form>
  );
}
