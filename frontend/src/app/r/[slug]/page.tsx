import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGet, type Restaurant } from "@/lib/api";
import RestaurantView from "./RestaurantView";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await apiGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`);
  return { title: restaurant ? `${restaurant.name} – Zedeka` : "Restaurant introuvable – Zedeka" };
}

export default async function RestaurantPage({ params }: Props) {
  const { slug } = await params;
  const restaurant = await apiGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`);
  if (!restaurant) notFound();
  return <RestaurantView restaurant={restaurant} />;
}
