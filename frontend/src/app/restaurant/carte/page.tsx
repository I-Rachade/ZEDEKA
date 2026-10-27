"use client";

import MenuEditor from "@/components/panel/MenuEditor";
import { ErrorNote, Loading, PageHeader } from "@/components/panel/ui";
import { restaurantFetch, type Menu } from "@/lib/restaurant";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";

export default function RestaurantMenuPage() {
  const { data, error, reload } = useRestaurant<Menu>("/menu");
  const action = useRestaurantAction();

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="menu"
        title="Carte"
        count={data.menuItems.length}
        description="Vos plats, leurs variantes et suppléments. Un plat marqué épuisé disparaît de la page de commande."
      />
      <MenuEditor items={data.menuItems} addons={data.addons} fetcher={restaurantFetch} base="" run={action.run} error={action.error} reload={reload} />
    </div>
  );
}
