import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("Devenir livreur")} – Zedeka`,
    description: t("Devenez livreur Zedeka à Lomé : livrez des repas et des colis, à votre rythme."),
    alternates: { canonical: "/devenir-livreur" },
  };
}

export default function DriverApplyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
