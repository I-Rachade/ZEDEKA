import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGet, type Restaurant, type Zone } from "@/lib/api";
import Checkout from "./Checkout";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Valider la commande – Zedeka" };

export default async function CheckoutPage({ params }: Props) {
  const { slug } = await params;
  const [restaurant, zones] = await Promise.all([apiGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`), apiGet<Zone[]>("/api/zones")]);
  if (!restaurant) notFound();
  return <Checkout restaurant={restaurant} zones={zones ?? []} />;
}
