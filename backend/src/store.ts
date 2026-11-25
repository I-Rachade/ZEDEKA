import type { PrismaClient } from "@prisma/client";
import { moduleView, type ModuleState } from "./services.js";

// Boutiques : ce sont des commerces de type « SHOP » (même fiche, même carte, même caisse que les restaurants).
// Ici, seulement leurs catégories et l'état du module « Boutiques » (SHOP) de la page Services : coupé par
// défaut, la rubrique n'apparaît pas aux clients.

export const STORE_CATEGORIES = [
  { key: "mode", label: "Mode", emoji: "👗" },
  { key: "beaute", label: "Beauté", emoji: "💄" },
  { key: "telephones", label: "Téléphones et électronique", emoji: "📱" },
  { key: "epicerie", label: "Épicerie et boissons", emoji: "🛒" },
  // Courses du quotidien (rubrique /app/courses) : supermarché, pharmacie, gaz et eau, avec l'épicerie.
  { key: "supermarche", label: "Supermarché", emoji: "🧺" },
  { key: "pharmacie", label: "Pharmacie", emoji: "💊" },
  { key: "gaz-eau", label: "Gaz et eau", emoji: "🔥" },
  { key: "maison", label: "Maison et cuisine", emoji: "🏠" },
  { key: "enfants", label: "Enfants et bébé", emoji: "🧸" },
  { key: "sport", label: "Sport et loisirs", emoji: "⚽" },
  { key: "autres", label: "Autres", emoji: "🛍️" },
] as const;
export const CATEGORY_KEYS = STORE_CATEGORIES.map((c) => c.key) as unknown as [string, ...string[]];
// Catégories de la rubrique « Courses du quotidien » (filtre `?group=quotidien` de /api/shops).
export const DAILY_CATEGORIES = ["supermarche", "pharmacie", "gaz-eau", "epicerie"] as const;

// Filtre de catégorie de la liste des boutiques : une catégorie, ou un groupe (quotidien), ou rien.
export function categoryFilter(category: string | null, group: string | null): string | { in: string[] } | undefined {
  if (category) return category;
  if (group === "quotidien") return { in: [...DAILY_CATEGORIES] };
  return undefined;
}

export const SHOP_CLOSED = "La vente en ligne n'est pas encore ouverte sur Zedeka.";

// État du module « Boutiques » : OFF (rien pour les clients), SOON (« Bientôt ») ou ON (rubrique ouverte).
export async function shopModule(prisma: PrismaClient): Promise<ModuleState> {
  return (await moduleView(prisma, "SHOP"))?.state ?? "OFF";
}
