import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Hors ligne")} – Zedeka` };
}

export default async function Offline() {
  const t = await getT();
  return (
    <div className="space-y-3 py-10 text-center">
      <p className="text-4xl" aria-hidden="true">
        📶
      </p>
      <h1 className="text-xl font-bold">{t("Pas de connexion")}</h1>
      <p className="text-stone-600">{t("Vérifiez vos données mobiles ou le Wi-Fi, puis réessayez. Votre panier est gardé sur votre téléphone.")}</p>
      <a href="/app" className="inline-block rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white">
        {t("Réessayer")}
      </a>
    </div>
  );
}
