import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type Restaurant } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";
import RestaurantView from "./RestaurantView";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await serverGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`);
  return { title: restaurant ? `${restaurant.name} – Zedeka` : "Restaurant introuvable – Zedeka" };
}

export default async function RestaurantPage({ params }: Props) {
  const { slug } = await params;
  const restaurant = await serverGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`);
  if (!restaurant) notFound();
  return <RestaurantView restaurant={restaurant} />;
}
