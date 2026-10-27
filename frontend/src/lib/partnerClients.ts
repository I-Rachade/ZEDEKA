"use client";

import type { PartnerClient } from "@/components/panel/partner";
import { rental } from "./rental";
import { logout, restaurantFetch, saveRestaurantSession } from "./restaurant";

export const restaurantClient: PartnerClient = {
  area: "restaurant",
  base: "/restaurant",
  apiFetch: restaurantFetch,
  saveSession: saveRestaurantSession,
  logout,
};

export const rentalClient: PartnerClient = {
  area: "location",
  base: "/location",
  apiFetch: rental.apiFetch,
  saveSession: rental.saveSession,
  logout: rental.logout,
};
