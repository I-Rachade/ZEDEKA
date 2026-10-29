import type { Metadata } from "next";
import { type ParcelCategory, type ParcelPricing, type Zone } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";
import ParcelForm from "./ParcelForm";

export const metadata: Metadata = { title: "Envoyer un colis – Zedeka" };

export default async function ParcelPage() {
  const [zones, categories, pricing, policies] = await Promise.all([
    serverGet<Zone[]>("/api/zones"),
    serverGet<ParcelCategory[]>("/api/parcel-categories"),
    serverGet<ParcelPricing>("/api/parcel-pricing"),
    serverGet<{ mobileMoneyEnabled?: boolean }>("/api/policies"),
  ]);
  return (
    <ParcelForm
      zones={zones ?? []}
      categories={categories ?? []}
      pricing={pricing ?? { minFee: 1000, perKmFee: 200, maxFee: null }}
      mobileMoney={!!policies?.mobileMoneyEnabled}
    />
  );
}
