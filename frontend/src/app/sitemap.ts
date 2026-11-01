import type { MetadataRoute } from "next";
import { serverGet } from "@/lib/serverApi";
import { SITE_URL } from "@/lib/site";

// Plan du site pour Google : les pages publiques et la page de chaque restaurant actif, lue dans l'API à chaque visite.
const PAGES: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }[] = [
  { path: "/app", priority: 1, changeFrequency: "daily" },
  { path: "/colis", priority: 0.8, changeFrequency: "monthly" },
  { path: "/app/aide", priority: 0.4, changeFrequency: "monthly" },
  { path: "/app/conditions", priority: 0.2, changeFrequency: "monthly" },
  { path: "/app/confidentialite", priority: 0.2, changeFrequency: "monthly" },
  { path: "/app/annulation", priority: 0.2, changeFrequency: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Si l'API ne répond pas, le plan garde au moins les pages fixes.
  const restaurants = await serverGet<{ slug: string }[]>("/api/restaurants").catch(() => null);
  return [
    ...PAGES.map((p) => ({ url: `${SITE_URL}${p.path}`, priority: p.priority, changeFrequency: p.changeFrequency })),
    ...(restaurants ?? []).map((r) => ({
      url: `${SITE_URL}/r/${encodeURIComponent(r.slug)}`,
      priority: 0.9,
      changeFrequency: "daily" as const,
    })),
  ];
}
