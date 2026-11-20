"use client";

import BannersBlock from "@/components/panel/BannersBlock";
import { ErrorNote, Loading, PageHeader } from "@/components/panel/ui";
import type { AdminBanner } from "@/lib/admin";
import { restaurantFetch, restaurantUploadImage, type Menu } from "@/lib/restaurant";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";

// Bannières de la boutique : images ou vidéos en haut de sa page, qui peuvent mener à un article.
export default function RestaurantBannersPage() {
  const banners = useRestaurant<AdminBanner[]>("/banners");
  const menu = useRestaurant<Menu>("/menu");
  const action = useRestaurantAction();
  const error = banners.error ?? menu.error;
  if (error) return <ErrorNote message={error} />;
  if (!banners.data || !menu.data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader icon="grid" title="Bannières" count={banners.data.length} description="Elles s'affichent en haut de votre page, dans l'ordre choisi ici." />
      <ErrorNote message={action.error} />
      <BannersBlock
        api={{
          create: (body) => restaurantFetch("/banners", { method: "POST", body }),
          patch: (id, body) => restaurantFetch(`/banners/${id}`, { method: "PATCH", body }),
          remove: (id) => restaurantFetch(`/banners/${id}`, { method: "DELETE" }),
          upload: (photo) => restaurantUploadImage("/images", photo),
        }}
        banners={banners.data}
        items={menu.data.menuItems}
        run={action.run}
        reload={banners.reload}
      />
    </div>
  );
}
