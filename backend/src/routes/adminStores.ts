import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "../notify.js";
import { staffName } from "../team.js";
import { HttpError, write } from "./adminWrite.js";
import { bannerSelect, CATEGORY_KEYS, productCounts, productSelect, productView, STORE_CATEGORIES, storeSelect, storeView, uniqueSlug } from "../store.js";

// Admin : boutiques en ligne des marchands (src/store.ts). L'équipe vérifie la demande (pièce ou IFU, photos),
// choisit la catégorie et la facturation (commission en % ou abonnement mensuel, comme les restaurants), met la
// boutique en ligne, la refuse ou la suspend, et vérifie les premiers produits.

const storeDecision = z.object({
  status: z.enum(["ONLINE", "REJECTED", "SUSPENDED"]),
  note: z.string().trim().max(300).optional(),
  storeCategory: z.enum(CATEGORY_KEYS),
  // Comme les restaurants : un taux en % ; 0 % avec un abonnement mensuel en FCFA.
  storeCommissionRate: z.number().int().min(0, "Taux positif").max(50, "50 % au plus"),
  storeSubscriptionFee: z.union([z.number().int().min(0).max(1_000_000), z.null()]),
});

const productDecision = z.object({ review: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(300).optional() });

const listSelect = {
  id: true,
  shopName: true,
  phone: true,
  pickupAddress: true,
  active: true,
  customerId: true,
  customer: { select: { name: true } },
  ...storeSelect,
} as const;

export function adminStoresRouter(prisma: PrismaClient, config: { notifier: Notifier }) {
  const router = Router();

  // Boutiques qui ont demandé la vente en ligne, avec le nombre de produits à vérifier.
  router.get("/stores", async (_req, res) => {
    const rows = await prisma.merchant.findMany({ where: { storeStatus: { not: "NONE" } }, orderBy: [{ storeRequestedAt: "desc" }], select: listSelect });
    const pending = await prisma.product.groupBy({ by: ["merchantId"], where: { merchantId: { in: rows.map((r) => r.id) }, archivedAt: null, review: "PENDING" }, _count: { _all: true } });
    const total = await prisma.product.groupBy({ by: ["merchantId"], where: { merchantId: { in: rows.map((r) => r.id) }, archivedAt: null }, _count: { _all: true } });
    res.json({
      categories: STORE_CATEGORIES,
      stores: rows.map((r) => ({
        id: r.id,
        shopName: r.shopName,
        phone: r.phone,
        owner: r.customer.name,
        area: r.pickupAddress,
        active: r.active,
        ...storeView(r),
        products: total.find((x) => x.merchantId === r.id)?._count._all ?? 0,
        toReview: pending.find((x) => x.merchantId === r.id)?._count._all ?? 0,
      })),
    });
  });

  router.get("/stores/:id", async (req, res) => {
    const m = await prisma.merchant.findUnique({ where: { id: req.params.id }, select: { ...listSelect, storeReviewedBy: true, payoutPhone: true, createdAt: true } });
    if (!m) return void res.status(404).json({ error: "Boutique introuvable" });
    const [products, banners, counts] = await Promise.all([
      prisma.product.findMany({ where: { merchantId: m.id, archivedAt: null }, orderBy: [{ review: "desc" }, { createdAt: "desc" }], select: productSelect }),
      prisma.storeBanner.findMany({ where: { merchantId: m.id }, orderBy: [{ position: "asc" }], select: bannerSelect }),
      productCounts(prisma, m.id),
    ]);
    res.json({
      id: m.id,
      shopName: m.shopName,
      phone: m.phone,
      owner: m.customer.name,
      area: m.pickupAddress,
      payoutPhone: m.payoutPhone,
      active: m.active,
      createdAt: m.createdAt,
      reviewedBy: m.storeReviewedBy,
      ...storeView(m),
      counts,
      products: products.map(productView),
      banners,
      categories: STORE_CATEGORIES,
    });
  });

  // Décision sur la boutique : en ligne, refusée ou suspendue, avec sa catégorie et sa facturation.
  router.patch(
    "/stores/:id",
    write(storeDecision, async (data, id, res) => {
      const m = await prisma.merchant.findUnique({ where: { id }, select: { id: true, shopName: true, customerId: true, storeStatus: true, storeSlug: true } });
      if (!m || m.storeStatus === "NONE") throw new HttpError(404, "Boutique introuvable");
      const status = data.status ?? m.storeStatus;
      const category = data.storeCategory;
      if (status === "ONLINE" && !category && !(await prisma.merchant.count({ where: { id, storeCategory: { not: null } } }))) throw new HttpError(400, "Choisissez la catégorie de la boutique");
      if ((data.status === "REJECTED" || data.status === "SUSPENDED") && !data.note) throw new HttpError(400, "Indiquez le motif, il sera montré au marchand");
      const rate = data.storeCommissionRate;
      if (rate === 0 && !data.storeSubscriptionFee) throw new HttpError(400, "Sans commission, indiquez l'abonnement mensuel");
      const decided = data.status && data.status !== m.storeStatus;
      const row = await prisma.merchant.update({
        where: { id },
        data: {
          ...(data.status ? { storeStatus: data.status } : {}),
          ...(category ? { storeCategory: category } : {}),
          ...(rate !== undefined ? { storeCommissionRate: rate } : {}),
          // Un taux au-dessus de 0 % : plus d'abonnement (une seule facturation à la fois).
          ...(data.storeSubscriptionFee !== undefined || (rate ?? 0) > 0 ? { storeSubscriptionFee: (rate ?? 0) > 0 ? null : data.storeSubscriptionFee } : {}),
          ...(data.status === "ONLINE" && !m.storeSlug ? { storeSlug: await uniqueSlug(prisma, m.shopName, m.id) } : {}),
          ...(data.status ? { storeNote: data.status === "ONLINE" ? null : data.note } : data.note !== undefined ? { storeNote: data.note || null } : {}),
          ...(decided ? { storeReviewedAt: new Date(), storeReviewedBy: staffName(res) } : {}),
        },
        select: storeSelect,
      });
      if (decided) {
        const notice =
          data.status === "ONLINE"
            ? { title: "Votre boutique est validée", body: `${m.shopName} est prête pour la vente en ligne sur Zedeka.` }
            : data.status === "REJECTED"
              ? { title: "Boutique à compléter", body: data.note ?? "Ouvrez l'appli marchand pour voir ce qui manque." }
              : { title: "Boutique suspendue", body: data.note ?? "Contactez Zedeka." };
        void config.notifier.push("customer", m.customerId, { ...notice, url: "/marchand/produits", tag: `store-${m.id}` }).catch(() => {});
      }
      return storeView(row);
    }, { partial: true }),
  );

  // Vérification d'un produit : accepté (visible), ou refusé avec le motif montré au marchand.
  router.patch(
    "/stores/products/:id",
    write(productDecision, async (data, id) => {
      const p = await prisma.product.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
      if (!p) throw new HttpError(404, "Produit introuvable");
      if (data.review === "REJECTED" && !data.note) throw new HttpError(400, "Indiquez le motif, il sera montré au marchand");
      const row = await prisma.product.update({
        where: { id },
        data: { review: data.review, reviewNote: data.review === "REJECTED" ? data.note : null, reviewedAt: new Date() },
        select: productSelect,
      });
      return productView(row);
    }),
  );

  // Accepter d'un coup tous les produits à vérifier d'une boutique.
  router.post("/stores/:id/approve-products", async (req, res) => {
    const { count } = await prisma.product.updateMany({ where: { merchantId: req.params.id, archivedAt: null, review: "PENDING" }, data: { review: "APPROVED", reviewNote: null, reviewedAt: new Date() } });
    res.json({ approved: count });
  });

  return router;
}
