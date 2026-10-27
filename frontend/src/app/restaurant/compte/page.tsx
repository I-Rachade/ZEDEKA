"use client";

import { AccountPage } from "@/components/panel/PartnerAccount";
import { ErrorNote, Loading } from "@/components/panel/ui";
import { restaurantClient } from "@/lib/partnerClients";
import type { Me } from "@/lib/restaurant";
import { useRestaurant } from "../useRestaurant";

export default function RestaurantAccountPage() {
  const { data, error } = useRestaurant<Me>("/me");
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  return <AccountPage api={restaurantClient} name={data.name} email={data.ownerEmail} phone={data.phone} what="nouvelle commande" />;
}
