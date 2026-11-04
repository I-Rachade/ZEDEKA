"use client";

import { useNetwork } from "@/lib/panelCache";
import { useT } from "@/lib/i18n/client";

// Bandeau des espaces restaurant et admin quand la connexion tombe : les pages gardent ce qu'elles montraient,
// avec l'heure de la dernière mise à jour ; tout se recharge seul au retour du réseau.
export default function ConnectionBanner() {
  const { offline, lastOk } = useNetwork();
  const t = useT();
  if (!offline) return null;
  const time = lastOk ? new Date(lastOk).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" }) : null;
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-stone-800 px-4 py-2 text-sm text-white">
      <span className="font-semibold text-amber-300">{t("Connexion perdue.")}</span>
      <span>{time ? t("Données de {time} affichées, mise à jour au retour du réseau.", { time }) : t("Les données affichées sont celles gardées sur cet appareil.")}</span>
    </div>
  );
}
