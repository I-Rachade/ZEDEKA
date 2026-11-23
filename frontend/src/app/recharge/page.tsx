import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import ChargingApp from "./ChargingApp";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("Recharge et échange de batteries")} – Zedeka`,
    description: t("Rechargez votre moto électrique ou échangez sa batterie dans une station Zedeka. Ouvert à toutes les motos, sur réservation ou sans."),
  };
}

// Page publique : stations de recharge et d'échange de batteries, ouvertes à toutes les motos électriques.
export default function ChargingPage() {
  return <ChargingApp />;
}
