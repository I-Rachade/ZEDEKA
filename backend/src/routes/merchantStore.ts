import type { Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "../notify.js";
import type { FileStore } from "../storage.js";
import { firstError } from "../util.js";
import { rawImage, rawVideo, storeMenuImage, storeVideo } from "./menuImages.js";
import {
  bannerInput,
  bannerSelect,
  canRequest,
  initialReview,
  MAX_BANNERS,
  MAX_PRODUCTS,
  productCounts,
  productInput,
  productSelect,
  productView,
  REVIEWED_FIRST,
  reviewAfterEdit,
  SHOP_CLOSED,
  shopModule,
  STORE_CATEGORIES,
  storeInput,
  storeSelect,
  storeView,
  type Review,
} from "../store.js";

// Boutique en ligne dans l'appli marchand (/api/marchand/store, /products, /banners) : catalogue, bannières
// publicitaires (images et vidéos en carrousel) et demande de mise en ligne. Voir src/store.ts.

type Config = { notifier: Notifier; files?: FileStore; frontendOrigin: string };
type Shop = { id: string; shopName: string; phone: string };

// Dossier des photos et vidéos d'une boutique (à part de ceux des restaurants).
export const mediaFolder = (merchantId: string) => `shop-${merchantId}`;

export function mountStoreRoutes(router: Router, prisma: PrismaClient, config: Config, merchantOf: (res: Response) => Shop | null) {
  // Boutique créée et module « Boutiques » ouvert aux marchands (Bientôt ou Proposé).
  async function shop(res: Response): Promise<Shop | null> {
    const m = merchantOf(res);
    if (!m) {
      res.status(404).json({ error: "Créez d'abord votre boutique" });
      return null;
    }
    if ((await shopModule(prisma)) === "OFF") {
      res.status(403).json({ error: SHOP_CLOSED });
      return null;
    }
    return m;
  }

  const bad = (res: Response, error: z.ZodError) => res.status(400).json({ error: firstError(error) });

  // État de la vente en ligne : module, boutique, compteurs. Répond même module coupé, pour cacher l'entrée.
  router.get("/store", async (_req, res) => {
    const m = merchantOf(res);
    const module = await shopModule(prisma);
    if (!m || module === "OFF") {
      res.json({ module, store: null });
      return;
    }
    const [row, counts, banners] = await Promise.all([
      prisma.merchant.findUnique({ where: { id: m.id }, select: storeSelect }),
      productCounts(prisma, m.id),
      prisma.storeBanner.count({ where: { merchantId: m.id } }),
    ]);
    res.json({ module, store: row && storeView(row), counts: { ...counts, banners }, categories: STORE_CATEGORIES, reviewedFirst: REVIEWED_FIRST });
  });

  // Présentation de la boutique (catégorie, description, logo, pièce). Modifiable à tout moment.
  router.patch("/store", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const parsed = storeInput.partial().safeParse(req.body ?? {});
    if (!parsed.success) return void bad(res, parsed.error);
    const row = await prisma.merchant.update({ where: { id: m.id }, data: parsed.data, select: storeSelect });
    res.json(storeView(row));
  });

  // Demande de mise en ligne : présentation complète et au moins un produit avec photo.
  router.post("/store/request", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const parsed = storeInput.safeParse(req.body ?? {});
    if (!parsed.success) return void bad(res, parsed.error);
    const current = await prisma.merchant.findUnique({ where: { id: m.id }, select: { storeStatus: true } });
    if (!current || !canRequest(current.storeStatus)) {
      res.status(409).json({ error: current?.storeStatus === "PENDING" ? "Votre demande est déjà en cours de vérification" : "Votre boutique a déjà été examinée : contactez Zedeka" });
      return;
    }
    if (!(await prisma.product.count({ where: { merchantId: m.id, archivedAt: null } }))) {
      res.status(400).json({ error: "Ajoutez au moins un produit avant de demander la mise en ligne" });
      return;
    }
    const now = new Date();
    const row = await prisma.merchant.update({
      where: { id: m.id },
      data: { ...parsed.data, storeStatus: "PENDING", storeRequestedAt: now, storeNote: null },
      select: storeSelect,
    });
    void config.notifier.staff("APPLICATIONS", {
      title: `Boutique à valider : ${m.shopName}`,
      body: `Vente en ligne demandée · ${m.phone}`,
      url: `/admin/marchands/${m.id}`,
      tag: `store-${m.id}`,
    });
    res.json(storeView(row));
  });

  // Catalogue : produits non supprimés, dans l'ordre choisi puis les plus récents.
  router.get("/products", async (_req, res) => {
    const m = await shop(res);
    if (!m) return;
    const rows = await prisma.product.findMany({ where: { merchantId: m.id, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], select: productSelect });
    res.json(rows.map(productView));
  });

  router.get("/products/:id", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const p = await prisma.product.findFirst({ where: { id: req.params.id, merchantId: m.id, archivedAt: null }, select: productSelect });
    if (!p) return void res.status(404).json({ error: "Produit introuvable" });
    res.json(productView(p));
  });

  router.post("/products", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const parsed = productInput.safeParse(req.body ?? {});
    if (!parsed.success) return void bad(res, parsed.error);
    const counts = await productCounts(prisma, m.id);
    if (counts.total >= MAX_PRODUCTS) return void res.status(409).json({ error: `${MAX_PRODUCTS} produits au plus par boutique` });
    const { options, imageUrls, ...data } = parsed.data;
    const review = initialReview(counts.approved);
    const p = await prisma.product.create({
      data: { ...data, options: JSON.stringify(options), imageUrls: JSON.stringify(imageUrls), merchantId: m.id, review, reviewedAt: review === "APPROVED" ? new Date() : null },
      select: productSelect,
    });
    res.status(201).json(productView(p));
  });

  router.patch("/products/:id", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const parsed = productInput.partial().safeParse(req.body ?? {});
    if (!parsed.success) return void bad(res, parsed.error);
    const before = await prisma.product.findFirst({ where: { id: req.params.id, merchantId: m.id, archivedAt: null }, select: productSelect });
    if (!before) return void res.status(404).json({ error: "Produit introuvable" });
    const { options, imageUrls, ...data } = parsed.data;
    const nextImages = imageUrls ? JSON.stringify(imageUrls) : before.imageUrls;
    // Ce que l'équipe vérifie : nom, description et photos. Prix, stock, rayon et visibilité restent libres.
    const contentChanged =
      (data.name !== undefined && data.name !== before.name) || (data.description !== undefined && data.description !== before.description) || nextImages !== before.imageUrls;
    const { approved } = await productCounts(prisma, m.id);
    const review = reviewAfterEdit(before.review as Review, approved, contentChanged);
    const p = await prisma.product.update({
      where: { id: before.id },
      data: {
        ...data,
        ...(options ? { options: JSON.stringify(options) } : {}),
        imageUrls: nextImages,
        review,
        ...(review !== before.review ? { reviewNote: null, reviewedAt: review === "APPROVED" ? new Date() : null } : {}),
      },
      select: productSelect,
    });
    res.json(productView(p));
  });

  // Supprimer : le produit disparaît du catalogue, gardé pour l'historique des commandes.
  router.delete("/products/:id", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const { count } = await prisma.product.updateMany({ where: { id: req.params.id, merchantId: m.id, archivedAt: null }, data: { archivedAt: new Date(), visible: false } });
    if (!count) return void res.status(404).json({ error: "Produit introuvable" });
    await prisma.storeBanner.updateMany({ where: { merchantId: m.id, productId: req.params.id }, data: { productId: null } });
    res.json({ ok: true });
  });

  // Photos des produits, logo et bannières : même circuit que les photos des plats.
  router.post("/store/images", rawImage, async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    if (!config.files) return void res.status(503).json({ error: "Envoi de photos indisponible" });
    await storeMenuImage(req, res, config.files, mediaFolder(m.id), config.frontendOrigin);
  });

  router.post("/store/videos", rawVideo, async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    if (!config.files) return void res.status(503).json({ error: "Envoi de vidéos indisponible" });
    await storeVideo(req, res, config.files, mediaFolder(m.id), config.frontendOrigin);
  });

  // Bannières du carrousel de la page boutique.
  router.get("/banners", async (_req, res) => {
    const m = await shop(res);
    if (!m) return;
    res.json(await prisma.storeBanner.findMany({ where: { merchantId: m.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: bannerSelect }));
  });

  async function ownProduct(merchantId: string, productId: string | null | undefined) {
    if (!productId) return true;
    return !!(await prisma.product.findFirst({ where: { id: productId, merchantId, archivedAt: null }, select: { id: true } }));
  }

  router.post("/banners", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const parsed = bannerInput.safeParse(req.body ?? {});
    if (!parsed.success) return void bad(res, parsed.error);
    const count = await prisma.storeBanner.count({ where: { merchantId: m.id } });
    if (count >= MAX_BANNERS) return void res.status(409).json({ error: `${MAX_BANNERS} bannières au plus` });
    if (!(await ownProduct(m.id, parsed.data.productId))) return void res.status(400).json({ error: "Produit introuvable" });
    const b = await prisma.storeBanner.create({ data: { ...parsed.data, posterUrl: parsed.data.posterUrl ?? null, productId: parsed.data.productId ?? null, merchantId: m.id, position: count }, select: bannerSelect });
    res.status(201).json(b);
  });

  router.patch("/banners/:id", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const parsed = bannerInput.partial().safeParse(req.body ?? {});
    if (!parsed.success) return void bad(res, parsed.error);
    if (!(await ownProduct(m.id, parsed.data.productId))) return void res.status(400).json({ error: "Produit introuvable" });
    const { count } = await prisma.storeBanner.updateMany({ where: { id: req.params.id, merchantId: m.id }, data: parsed.data });
    if (!count) return void res.status(404).json({ error: "Bannière introuvable" });
    res.json(await prisma.storeBanner.findUnique({ where: { id: req.params.id }, select: bannerSelect }));
  });

  router.delete("/banners/:id", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const { count } = await prisma.storeBanner.deleteMany({ where: { id: req.params.id, merchantId: m.id } });
    if (!count) return void res.status(404).json({ error: "Bannière introuvable" });
    res.json({ ok: true });
  });

  // Nouvel ordre du carrousel : la liste des bannières, de la première à la dernière.
  router.put("/banners/order", async (req, res) => {
    const m = await shop(res);
    if (!m) return;
    const parsed = z.object({ ids: z.array(z.string().min(1)).min(1).max(MAX_BANNERS) }).safeParse(req.body ?? {});
    if (!parsed.success) return void bad(res, parsed.error);
    await Promise.all(parsed.data.ids.map((id, i) => prisma.storeBanner.updateMany({ where: { id, merchantId: m.id }, data: { position: i } })));
    res.json(await prisma.storeBanner.findMany({ where: { merchantId: m.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: bannerSelect }));
  });

  // Aperçu : la page boutique telle que les clients la verront (produits publiés et bannières actives).
  router.get("/store/preview", async (_req, res) => {
    const m = await shop(res);
    if (!m) return;
    const [row, products, banners] = await Promise.all([
      prisma.merchant.findUnique({ where: { id: m.id }, select: { ...storeSelect, shopName: true, pickupAddress: true } }),
      prisma.product.findMany({ where: { merchantId: m.id, archivedAt: null, visible: true, review: "APPROVED" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], select: productSelect }),
      prisma.storeBanner.findMany({ where: { merchantId: m.id, active: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: bannerSelect }),
    ]);
    if (!row) return void res.status(404).json({ error: "Boutique introuvable" });
    res.json({ name: row.shopName, area: row.pickupAddress, store: storeView(row), products: products.map(productView), banners });
  });
}
