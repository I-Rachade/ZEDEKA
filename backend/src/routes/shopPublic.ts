import { type Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { categoryFilter, SHOP_CLOSED, shopModule, STORE_CATEGORIES } from "../store.js";
import { isSponsored, sponsoredFirst } from "../loyalty.js";

// Côté client : la rubrique « Boutiques ». Elle liste les commerces de type Boutique (créés dans « Commerces » de
// l'admin) ; chacun s'ouvre sur sa page /r/…, avec le même panier et la même caisse que les restaurants.
// Tout est fermé tant que le module « Boutiques » n'est pas ouvert dans la page Services de l'admin.

const categoryOf = (key: string | null) => STORE_CATEGORIES.find((c) => c.key === key) ?? null;

export function shopPublicRouter(prisma: PrismaClient) {
  const router = Router();

  // Module fermé (ou seulement annoncé « Bientôt ») : rien n'est listé, la réponse le dit.
  async function open(res: Response): Promise<boolean> {
    if ((await shopModule(prisma)) === "ON") return true;
    res.status(404).json({ error: SHOP_CLOSED });
    return false;
  }

  // Boutiques ouvertes avec au moins un article disponible, filtrées par catégorie.
  router.get("/shops", async (req, res) => {
    if (!(await open(res))) return;
    const category = typeof req.query.category === "string" ? req.query.category : null;
    const filter = categoryFilter(category, typeof req.query.group === "string" ? req.query.group : null);
    const commerces = await prisma.restaurant.findMany({
      where: { active: true, deletedAt: null, kind: "SHOP", ...(filter ? { shopCategory: filter } : {}), menuItems: { some: { available: true } } },
      orderBy: { name: "asc" },
      take: 100,
      select: {
        slug: true,
        name: true,
        address: true,
        shopCategory: true,
        logoUrl: true,
        sponsoredUntil: true,
        banners: { where: { active: true, kind: "IMAGE" }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 1, select: { url: true } },
        menuItems: { where: { available: true, imageUrl: { not: null } }, orderBy: { sortOrder: "asc" }, take: 3, select: { imageUrl: true } },
        _count: { select: { menuItems: { where: { available: true } } } },
      },
    });
    res.json({
      categories: STORE_CATEGORIES,
      // Boutiques mises en avant (pub payée) en tête, avec le badge « Sponsorisé ».
      shops: sponsoredFirst(commerces.map((c) => ({ ...c, sponsored: isSponsored(c.sponsoredUntil) }))).map((c) => ({
        slug: c.slug,
        href: `/r/${c.slug}`,
        name: c.name,
        area: c.address,
        category: categoryOf(c.shopCategory),
        logoUrl: c.logoUrl,
        coverUrl: c.banners[0]?.url ?? null,
        photos: c.menuItems.map((i) => i.imageUrl).filter((u): u is string => !!u),
        productCount: c._count.menuItems,
        sponsored: c.sponsored,
      })),
    });
  });

  return router;
}
