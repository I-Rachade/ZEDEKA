"use client";

import MenuEditor from "@/components/panel/MenuEditor";
import { ErrorNote, Loading, PageHeader } from "@/components/panel/ui";
import { restaurantFetch, restaurantUploadImage, type Me, type Menu } from "@/lib/restaurant";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";

export default function RestaurantMenuPage() {
  const { data, error, reload } = useRestaurant<Menu>("/menu");
  const action = useRestaurantAction();
  const shop = useRestaurant<Me>("/me").data?.kind === "SHOP";

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="menu"
        title={shop ? "Articles" : "Carte"}
        count={data.menuItems.length}
        description={
          shop
            ? "Vos articles, leurs variantes, choix et stock. Un article épuisé ne peut plus être commandé."
            : "Vos plats, leurs variantes et suppléments. Un plat marqué épuisé disparaît de la page de commande."
        }
      />
      <MenuEditor items={data.menuItems} addons={data.addons} fetcher={restaurantFetch} upload={restaurantUploadImage} base="" run={action.run} error={action.error} reload={reload} />
    </div>
  );
}
