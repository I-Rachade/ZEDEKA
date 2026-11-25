"use client";

import FavoriteDrivers from "@/components/FavoriteDrivers";
import { PageHeader } from "@/components/panel/ui";
import { restaurantFetch } from "@/lib/restaurant";

// Livreurs favoris du restaurant : invitation, ordre, « Mon favori d'abord ».
export default function RestaurantDriversPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader icon="heart" title="Mes livreurs" description="Jusqu'à 3 livreurs Zedeka qui reçoivent vos courses en premier." />
      <FavoriteDrivers api={restaurantFetch} who="restaurant" />
    </div>
  );
}
