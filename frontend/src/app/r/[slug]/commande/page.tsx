import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type ParcelPricing, type Restaurant, type Zone } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import Checkout from "./Checkout";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Valider la commande")} – Zedeka` };
}

export default async function CheckoutPage({ params }: Props) {
  const { slug } = await params;
  const [restaurant, zones, policies] = await Promise.all([
    serverGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`),
    serverGet<Zone[]>("/api/zones"),
    serverGet<{ mobileMoneyEnabled?: boolean; foodPricing?: ParcelPricing }>("/api/policies"),
  ]);
  if (!restaurant) notFound();
  return <Checkout restaurant={restaurant} zones={zones ?? []} mobileMoney={!!policies?.mobileMoneyEnabled} pricing={policies?.foodPricing ?? null} />;
}
