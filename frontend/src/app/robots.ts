import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// robots.txt : Google peut tout explorer sauf les espaces privés (admin, restaurants, livreurs), l'API,
// les pages propres à un client (compte, commandes, paiement, suivi) et les liens de position.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/restaurant",
        "/livreur",
        "/position/",
        "/api/",
        "/commande/",
        "/r/*/commande",
        "/t/",
        "/suivi",
        "/app/connexion",
        "/app/profil",
        "/app/commandes",
        "/app/adresses",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
