"use client";

import type { PartnerClient } from "@/components/panel/partner";
import { logout, restaurantFetch, saveRestaurantSession } from "./restaurant";

export const restaurantClient: PartnerClient = {
  area: "restaurant",
  base: "/restaurant",
  apiFetch: restaurantFetch,
  saveSession: saveRestaurantSession,
  logout,
};

