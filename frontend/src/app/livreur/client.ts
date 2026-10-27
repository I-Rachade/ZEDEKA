import type { PartnerClient } from "@/components/panel/partner";
import { driverFetch, driverLogout } from "@/lib/driver";

// Client d'API pour les alertes (Web Push) du livreur.
export const driverClient: PartnerClient = { area: "livreur", base: "/livreur", apiFetch: driverFetch, saveSession: () => {}, logout: driverLogout };
