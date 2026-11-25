import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { favoriteView, sortFavorites } from "../favorites.js";

// Admin : liens « livreur favori » entre restaurants ou boutiques et livreurs (src/favorites.ts). Lecture pour la
// répartition ; retrait par le directeur ou l'adjoint (un lien qui pose problème).
export function adminFavoritesRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/favorites", async (req, res) => {
    const q = (k: string) => (typeof req.query[k] === "string" && req.query[k] ? String(req.query[k]) : undefined);
    const where = { restaurantId: q("restaurantId"), merchantId: q("merchantId"), driverId: q("driverId") };
    const rows = await prisma.favoriteDriver.findMany({
      where,
      orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
      take: 300,
      select: {
        id: true,
        rank: true,
        status: true,
        createdAt: true,
        respondedAt: true,
        invitedBy: true,
        restaurant: { select: { id: true, name: true } },
        merchant: { select: { id: true, shopName: true } },
        driver: { select: { id: true, name: true, phone: true, vehicle: true, employment: true, online: true, active: true, deletedAt: true } },
      },
    });
    res.json(
      sortFavorites(rows).map((r) => ({
        ...favoriteView(r),
        invitedBy: r.invitedBy,
        owner: r.restaurant ? { kind: "RESTAURANT", id: r.restaurant.id, name: r.restaurant.name } : r.merchant ? { kind: "MERCHANT", id: r.merchant.id, name: r.merchant.shopName } : null,
      })),
    );
  });

  router.delete("/favorites/:id", async (req, res) => {
    const { count } = await prisma.favoriteDriver.deleteMany({ where: { id: req.params.id } });
    if (!count) {
      res.status(404).json({ error: "Lien introuvable" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
