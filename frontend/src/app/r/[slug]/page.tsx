import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGet, type Restaurant, type Zone } from "@/lib/api";
import OrderForm from "./OrderForm";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await apiGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`);
  return { title: restaurant ? `${restaurant.name} – Zedeka` : "Restaurant introuvable – Zedeka" };
}

export default async function RestaurantPage({ params }: Props) {
  const { slug } = await params;
  const [restaurant, zones] = await Promise.all([
    apiGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`),
    apiGet<Zone[]>("/api/zones"),
  ]);
  if (!restaurant) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{restaurant.name}</h1>
        <p className="text-sm text-stone-600">{restaurant.address}</p>
      </div>
      <OrderForm restaurant={restaurant} zones={zones ?? []} />
    </div>
  );
}
