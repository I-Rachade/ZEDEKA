import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGet, fcfa, type Restaurant, type Zone } from "@/lib/api";
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
      <div className="flex items-center gap-3">
        {restaurant.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- logo fourni par le restaurant
          <img src={restaurant.logoUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-2xl font-bold">{restaurant.name}</h1>
          <p className="text-sm text-stone-600">
            {restaurant.address} · {restaurant.deliveryTimeMin}–{restaurant.deliveryTimeMax} min
            {restaurant.minOrderAmount > 0 && ` · minimum ${fcfa(restaurant.minOrderAmount)}`}
          </p>
        </div>
      </div>
      {!restaurant.availability.open && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Fermé pour le moment.</strong> {restaurant.availability.reason} Vous pouvez consulter la carte, mais pas commander.
        </p>
      )}
      <OrderForm restaurant={restaurant} zones={zones ?? []} />
    </div>
  );
}
