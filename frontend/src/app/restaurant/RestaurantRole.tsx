"use client";

import { createContext, useContext } from "react";
import type { RestaurantRole } from "@/lib/restaurant";

// Rôle de la personne connectée à l'espace restaurant (gérant, manageuse, caissière), fourni par RestaurantShell.
export const RestaurantRoleContext = createContext<RestaurantRole>("OWNER");
export const useRestaurantRole = () => useContext(RestaurantRoleContext);
