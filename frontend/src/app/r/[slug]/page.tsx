import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { type Restaurant } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import { SITE_URL } from "@/lib/site";
import RestaurantView from "./RestaurantView";

type Props = { params: Promise<{ slug: string }> };

// Une seule lecture de l'API par visite, partagée entre les métadonnées et la page.
const getRestaurant = cache((slug: string) => serverGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`));

const categoriesOf = (r: Restaurant) => [...new Set(r.menuItems.map((m) => m.category))].slice(0, 5);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await getRestaurant(slug);
  const t = await getT();
  if (!restaurant) return { title: `${t("Restaurant introuvable")} – Zedeka`, robots: { index: false } };
  const categories = categoriesOf(restaurant);
  const description = t("{name} à Lomé : commandez en ligne et faites-vous livrer en {min} à {max} min avec Zedeka.", {
    name: restaurant.name,
    min: restaurant.deliveryTimeMin,
    max: restaurant.deliveryTimeMax,
  });
  const title = t("{name} – Livraison à Lomé | Zedeka", { name: restaurant.name });
  const path = `/r/${encodeURIComponent(restaurant.slug)}`;
  return {
    title,
    description: categories.length ? `${description} ${categories.join(", ")}.` : description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Zedeka",
      title,
      description,
      url: path,
      ...(restaurant.logoUrl ? { images: [{ url: restaurant.logoUrl }] } : {}),
    },
  };
}

// Fiche « Restaurant » pour Google : nom, adresse, position, cuisine, commande en ligne.
function restaurantJsonLd(r: Restaurant) {
  const url = `${SITE_URL}/r/${encodeURIComponent(r.slug)}`;
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${url}#restaurant`,
    name: r.name,
    url,
    ...(r.logoUrl ? { image: r.logoUrl } : {}),
    address: { "@type": "PostalAddress", streetAddress: r.address, addressLocality: "Lomé", addressCountry: "TG" },
    ...(r.latitude !== null && r.longitude !== null ? { geo: { "@type": "GeoCoordinates", latitude: r.latitude, longitude: r.longitude } } : {}),
    servesCuisine: categoriesOf(r),
    hasMenu: url,
    acceptsReservations: false,
    potentialAction: {
      "@type": "OrderAction",
      target: { "@type": "EntryPoint", urlTemplate: url, actionPlatform: ["https://schema.org/DesktopWebPlatform", "https://schema.org/MobileWebPlatform"] },
      deliveryMethod: "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet",
    },
  };
}

export default async function RestaurantPage({ params }: Props) {
  const { slug } = await params;
  const restaurant = await getRestaurant(slug);
  if (!restaurant) notFound();
  // « < » échappé : un nom de plat ne peut pas fermer la balise script.
  const ld = JSON.stringify(restaurantJsonLd(restaurant)).replace(/</g, "\\u003c");
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <RestaurantView restaurant={restaurant} />
    </>
  );
}
