import type { Metadata } from "next";
import { type ParcelCategory, type ParcelPricing, type Zone } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import ParcelForm from "./ParcelForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("Envoyer un colis")} – Zedeka`,
    description: t("Envoyez un colis partout à Lomé avec Zedeka : un livreur le récupère et le dépose à la bonne adresse."),
    alternates: { canonical: "/colis" },
  };
}

export default async function ParcelPage() {
  const [zones, categories, pricing, policies] = await Promise.all([
    serverGet<Zone[]>("/api/zones"),
    serverGet<ParcelCategory[]>("/api/parcel-categories"),
    serverGet<ParcelPricing>("/api/parcel-pricing"),
    serverGet<{ mobileMoneyEnabled?: boolean; freeCancellationMinutes?: number; cancellationFeePercent?: number }>("/api/policies"),
  ]);
  return (
    <ParcelForm
      zones={zones ?? []}
      categories={categories ?? []}
      pricing={pricing ?? { minFee: 1000, perKmFee: 200, maxFee: null }}
      mobileMoney={!!policies?.mobileMoneyEnabled}
      cancellation={
        policies?.freeCancellationMinutes !== undefined && policies.cancellationFeePercent !== undefined
          ? { freeCancellationMinutes: policies.freeCancellationMinutes, cancellationFeePercent: policies.cancellationFeePercent }
          : null
      }
    />
  );
}
