import type { Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { normalizePhone } from "../customer.js";
import {
  DISPATCH_ROUTES,
  FavoriteError,
  inviteFavorite,
  listFavorites,
  type Owner,
  removeFavorite,
  reorderFavorites,
  routeOrders,
} from "../favorites.js";
import type { Notifier } from "../notify.js";
import { firstError } from "../util.js";

// Écran « Mes livreurs » de l'espace restaurant et de l'appli marchand, et choix « À mon livreur favori » /
// « Demande ouverte » sur les courses sans livreur. Mêmes routes des deux côtés (src/favorites.ts).
export type FavoriteHooks = {
  owner: (res: Response) => Owner | null;
  ownerName: (res: Response) => Promise<string>;
  // Inviter, retirer, réordonner, régler : gérant et manageuse au restaurant (pas la caissière), le marchand.
  canManage: (res: Response) => boolean;
  actorName: (res: Response) => string;
  favoriteFirst: (res: Response) => Promise<boolean>;
  setFavoriteFirst: (res: Response, value: boolean) => Promise<void>;
};

export function mountFavoriteRoutes(router: Router, prisma: PrismaClient, notifier: Notifier, hooks: FavoriteHooks) {
  function ownerOr404(res: Response): Owner | null {
    const o = hooks.owner(res);
    if (!o) res.status(404).json({ error: "Créez d'abord votre boutique" });
    return o;
  }
  function manager(res: Response) {
    if (hooks.canManage(res)) return true;
    res.status(403).json({ error: "Accès réservé au gérant ou à la manageuse" });
    return false;
  }
  async function run(res: Response, fn: () => Promise<unknown>) {
    try {
      res.json(await fn());
    } catch (e) {
      if (e instanceof FavoriteError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }
  }

  router.get("/favorites", async (_req, res) => {
    const owner = ownerOr404(res);
    if (!owner) return;
    const [favorites, favoriteFirst] = await Promise.all([listFavorites(prisma, owner), hooks.favoriteFirst(res)]);
    res.json({ favorites, favoriteFirst, canManage: hooks.canManage(res) });
  });

  router.post("/favorites", async (req, res) => {
    const owner = ownerOr404(res);
    if (!owner || !manager(res)) return;
    const parsed = z.object({ phone: z.string().trim().min(6, "Numéro du livreur requis").max(20) }).safeParse(req.body);
    const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
    if (!parsed.success || !phone) {
      res.status(400).json({ error: parsed.success ? "Numéro invalide" : firstError(parsed.error) });
      return;
    }
    await run(res, async () => inviteFavorite(prisma, notifier, owner, phone, hooks.actorName(res), await hooks.ownerName(res)));
  });

  router.put("/favorites/order", async (req, res) => {
    const owner = ownerOr404(res);
    if (!owner || !manager(res)) return;
    const parsed = z.object({ ids: z.array(z.string().min(1)).max(10) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    await run(res, () => reorderFavorites(prisma, owner, parsed.data.ids));
  });

  router.patch("/favorites/settings", async (req, res) => {
    const owner = ownerOr404(res);
    if (!owner || !manager(res)) return;
    const parsed = z.object({ favoriteFirst: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    await hooks.setFavoriteFirst(res, parsed.data.favoriteFirst);
    res.json({ favoriteFirst: parsed.data.favoriteFirst });
  });

  router.delete("/favorites/:id", async (req, res) => {
    const owner = ownerOr404(res);
    if (!owner || !manager(res)) return;
    await run(res, async () => {
      await removeFavorite(prisma, owner, String(req.params.id));
      return { ok: true };
    });
  });

  // « À mon livreur favori » ou « Demande ouverte » sur une ou plusieurs courses sans livreur.
  router.post("/dispatch", async (req, res) => {
    const owner = ownerOr404(res);
    if (!owner) return;
    const parsed = z.object({ orderIds: z.array(z.string().min(1)).min(1).max(50), route: z.enum(DISPATCH_ROUTES) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    await run(res, async () => ({ count: await routeOrders(prisma, notifier, owner, parsed.data.orderIds, parsed.data.route) }));
  });
}
