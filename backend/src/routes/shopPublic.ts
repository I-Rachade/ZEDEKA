import { type Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Notifier } from "../notify.js";
import { priceParcel } from "../parcel.js";
import { formatFcfa } from "../pricing.js";
import { CartError, priceCart, PRICES_CHANGED, pricesChanged, quantities, quoteInput, shopCommission, shopOrderInput } from "../shop.js";
import { bannerSelect, productSelect, productView, readJson, SHOP_CLOSED, shopModule, STORE_CATEGORIES } from "../store.js";
import { createOrderWithCode, firstError, getSettings } from "../util.js";
import { linkedCustomerId } from "./customer.js";
import { acceptTerms } from "./public.js";

// Côté client : la rubrique « Boutiques » (liste et page d'une boutique), le prix de la livraison et la
// commande. Tout est fermé tant que le module « Boutiques » n'est pas ouvert dans la page Services de l'admin.

type Config = { secret: string; notifier: Notifier };

const MOBILE_MONEY_OFF = "Le paiement mobile money n'est pas encore disponible : choisissez les espèces.";
// Les boutiques visibles : en ligne, et pas suspendues pour les colis.
const live = { storeStatus: "ONLINE", active: true, storeSlug: { not: null } } as const;
const published = { archivedAt: null, visible: true, review: "APPROVED" } as const;

const categoryOf = (key: string | null) => STORE_CATEGORIES.find((c) => c.key === key) ?? null;

export function shopPublicRouter(prisma: PrismaClient, config: Config) {
  const router = Router();

  // Module fermé (ou seulement annoncé « Bientôt ») : rien n'est vendu, la réponse le dit.
  async function open(res: Response): Promise<boolean> {
    if ((await shopModule(prisma)) === "ON") return true;
    res.status(404).json({ error: SHOP_CLOSED });
    return false;
  }

  async function storeBySlug(slug: string) {
    return prisma.merchant.findFirst({
      where: { ...live, storeSlug: slug.slice(0, 80) },
      select: {
        id: true,
        shopName: true,
        phone: true,
        pickupAddress: true,
        pickupLatitude: true,
        pickupLongitude: true,
        customerId: true,
        storeSlug: true,
        storeCategory: true,
        storeDescription: true,
        storeLogoUrl: true,
        storeCommissionRate: true,
        storeSubscriptionFee: true,
      },
    });
  }

  // Liste de la rubrique : boutiques en ligne avec au moins un produit, filtrées par catégorie.
  router.get("/shops", async (req, res) => {
    if (!(await open(res))) return;
    const category = typeof req.query.category === "string" ? req.query.category : null;
    const rows = await prisma.merchant.findMany({
      where: { ...live, ...(category ? { storeCategory: category } : {}), products: { some: published } },
      orderBy: { storeReviewedAt: "desc" },
      take: 100,
      select: {
        shopName: true,
        pickupAddress: true,
        storeSlug: true,
        storeCategory: true,
        storeLogoUrl: true,
        banners: { where: { active: true, kind: "IMAGE" }, orderBy: { position: "asc" }, take: 1, select: { url: true } },
        products: { where: published, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 3, select: { imageUrls: true } },
        _count: { select: { products: { where: published } } },
      },
    });
    res.json({
      categories: STORE_CATEGORIES,
      shops: rows.map((m) => ({
        slug: m.storeSlug,
        name: m.shopName,
        area: m.pickupAddress,
        category: categoryOf(m.storeCategory),
        logoUrl: m.storeLogoUrl,
        coverUrl: m.banners[0]?.url ?? null,
        photos: m.products.map((p) => readJson<string[]>(p.imageUrls, [])[0]).filter(Boolean),
        productCount: m._count.products,
      })),
    });
  });

  // Page d'une boutique : bannières, produits en vente (les épuisés restent visibles, grisés).
  router.get("/shops/:slug", async (req, res) => {
    if (!(await open(res))) return;
    const m = await storeBySlug(req.params.slug);
    if (!m) return void res.status(404).json({ error: "Boutique introuvable" });
    const [products, banners] = await Promise.all([
      prisma.product.findMany({ where: { merchantId: m.id, ...published }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], select: productSelect }),
      prisma.storeBanner.findMany({ where: { merchantId: m.id, active: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: bannerSelect }),
    ]);
    const settings = await getSettings(prisma);
    res.json({
      slug: m.storeSlug,
      name: m.shopName,
      area: m.pickupAddress,
      category: categoryOf(m.storeCategory),
      description: m.storeDescription,
      logoUrl: m.storeLogoUrl,
      verified: true,
      mobileMoney: settings.mobileMoneyEnabled,
      products: products.map((p) => {
        const v = productView(p);
        return { id: v.id, name: v.name, description: v.description, price: v.price, stock: Math.max(0, v.stock), section: v.section, options: v.options, imageUrls: v.imageUrls };
      }),
      banners,
    });
  });

  // Prix de la livraison jusqu'au point choisi (tarif des colis, depuis le point de ramassage de la boutique).
  router.post("/shops/:slug/quote", async (req, res) => {
    if (!(await open(res))) return;
    const parsed = quoteInput.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: firstError(parsed.error) });
    const m = await storeBySlug(req.params.slug);
    if (!m) return void res.status(404).json({ error: "Boutique introuvable" });
    const price = await priceParcel(prisma, await getSettings(prisma), { latitude: m.pickupLatitude, longitude: m.pickupLongitude }, parsed.data, NO_SURCHARGE, 0);
    res.json({ deliveryFee: price.fee + price.extraFee, km: price.km, zone: price.zoneName || null });
  });

  // Commande : compte client obligatoire (suivi, notifications, historique). Le stock est retiré tout de suite
  // et remis si la boutique refuse ou ne répond pas.
  router.post("/shops/:slug/orders", async (req, res) => {
    if (!(await open(res))) return;
    const customerId = await linkedCustomerId(prisma, req, config.secret);
    if (!customerId) return void res.status(401).json({ error: "Connectez-vous pour commander" });
    const parsed = shopOrderInput.extend({ acceptTerms }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: firstError(parsed.error) });
    const input = parsed.data;
    const m = await storeBySlug(req.params.slug);
    if (!m) return void res.status(404).json({ error: "Boutique introuvable" });
    if (m.customerId === customerId) return void res.status(400).json({ error: "Vous ne pouvez pas commander dans votre propre boutique" });
    const settings = await getSettings(prisma);
    if (input.paymentMethod === "MOBILE_MONEY" && !settings.mobileMoneyEnabled) return void res.status(400).json({ error: MOBILE_MONEY_OFF });

    const products = await prisma.product.findMany({
      where: { merchantId: m.id, id: { in: input.items.map((i) => i.productId) } },
      select: { id: true, name: true, price: true, stock: true, options: true, imageUrls: true, visible: true, review: true, archivedAt: true },
    });
    let cart;
    try {
      cart = priceCart(input.items, products);
    } catch (e) {
      if (e instanceof CartError) return void res.status(409).json({ error: e.message });
      throw e;
    }
    // Prix changés depuis que le client a ouvert la boutique : rien n'est retiré du stock, il revoit son panier.
    if (pricesChanged(input.expectedSubtotal, cart.subtotal)) {
      return void res.status(409).json({ error: PRICES_CHANGED, code: "PRICES_CHANGED", prices: Object.fromEntries(products.map((p) => [p.id, p.price])) });
    }

    // Stock retiré produit par produit, seulement s'il en reste assez ; sinon tout est remis et la commande refusée.
    const taken: [string, number][] = [];
    for (const [productId, quantity] of quantities(cart.lines)) {
      const { count } = await prisma.product.updateMany({ where: { id: productId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
      if (!count) {
        await restock(prisma, taken);
        const name = cart.lines.find((l) => l.productId === productId)?.name ?? "Un article";
        return void res.status(409).json({ error: `${name} vient d'être vendu : il n'en reste plus assez` });
      }
      taken.push([productId, quantity]);
    }

    try {
      const price = await priceParcel(prisma, settings, { latitude: m.pickupLatitude, longitude: m.pickupLongitude }, { latitude: input.latitude, longitude: input.longitude }, NO_SURCHARGE, 0);
      const deliveryFee = price.fee + price.extraFee;
      const now = new Date();
      const order = await createOrderWithCode(prisma, {
        type: "PARCEL",
        storeSale: true,
        merchantId: m.id,
        customerId,
        // Comme un colis du marchand : retrait chez la boutique (son nom et son numéro), livraison au client.
        customerName: m.shopName,
        customerPhone: m.phone,
        recipientName: input.customerName,
        recipientPhone: input.customerPhone,
        termsAcceptedAt: now,
        zoneId: price.zoneId,
        distanceKm: price.km,
        pickupAddress: m.pickupAddress,
        pickupLatitude: m.pickupLatitude,
        pickupLongitude: m.pickupLongitude,
        address: input.address || "Position sur la carte",
        latitude: input.latitude,
        longitude: input.longitude,
        locationSource: "SENDER",
        note: input.note || null,
        paymentMethod: input.paymentMethod,
        // Le client paie les articles et la livraison ; en espèces, le livreur encaisse le total à la porte.
        payer: "RECIPIENT",
        codAmount: input.paymentMethod === "CASH" ? cart.subtotal : 0,
        subtotal: cart.subtotal,
        deliveryFee,
        total: cart.subtotal + deliveryFee,
        commission: m.storeSubscriptionFee !== null && m.storeCommissionRate === 0 ? 0 : shopCommission(cart.subtotal, m.storeCommissionRate),
        storeItems: { create: cart.lines },
      });
      // Sonnerie chez le marchand, même si l'appli est fermée.
      void config.notifier.push("customer", m.customerId, {
        title: `Nouvelle commande ${order.code}`,
        body: `${cart.lines.reduce((s, l) => s + l.quantity, 0)} article(s) · ${formatFcfa(cart.subtotal)} · à accepter`,
        url: `/marchand/commandes/${order.code}`,
        tag: `shop-order-${order.id}`,
        alarm: true,
      });
      void config.notifier.staff("ORDERS", { title: `Boutique ${order.code}`, body: `${m.shopName} · ${formatFcfa(order.total)}`, url: `/admin/commandes/${order.id}`, tag: `order-${order.id}` });
      res.status(201).json({ code: order.code, total: order.total });
    } catch (e) {
      await restock(prisma, taken);
      throw e;
    }
  });

  return router;
}

// La livraison d'une vente : tarif des colis, sans supplément de catégorie ni de poids.
const NO_SURCHARGE = { surcharge: 0, perKgFee: 0 };

// Remet en stock ce qu'une commande avait retiré.
export async function restock(prisma: PrismaClient, taken: Iterable<[string, number]>) {
  for (const [id, quantity] of taken) await prisma.product.updateMany({ where: { id }, data: { stock: { increment: quantity } } });
}
