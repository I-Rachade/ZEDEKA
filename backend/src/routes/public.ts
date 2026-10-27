import { type Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { deliveryFee, distanceKm, parcelExtraFee } from "../delivery.js";
import { availability, parseHours } from "../openingHours.js";
import { foodDetails, formatFcfa, priceOrder, whatsappMessage, whatsappUrl } from "../pricing.js";
import { fold } from "../customer.js";
import { createOrderWithCode, firstError, getSettings, phone } from "../util.js";
import { linkedCustomerId } from "./customer.js";

type Config = { zedekaWhatsapp: string; secret: string };

const coords = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
};

const customer = {
  zoneId: z.string().min(1),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: phone,
  note: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(["CASH", "MOBILE_MONEY"]),
  ...coords,
};

const orderInput = z.object({
  ...customer,
  restaurantSlug: z.string().min(1),
  fulfillment: z.enum(["DELIVERY", "PICKUP"]).default("DELIVERY"),
  address: z.string().trim().max(300).default(""),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(50),
        variantId: z.string().optional(),
        addonIds: z.array(z.string()).max(20).optional(),
      }),
    )
    .min(1, "Le panier est vide"),
});

const parcelInput = z.object({
  ...customer,
  pickupAddress: z.string().trim().min(5).max(300),
  address: z.string().trim().min(5).max(300),
  recipientName: z.string().trim().min(2).max(80),
  recipientPhone: phone,
  parcelCategoryId: z.string().min(1),
  weightKg: z.number().min(0).max(100),
});

const driverApplication = z.object({
  name: z.string().trim().min(2).max(80),
  phone,
  vehicle: z.enum(["MOTO", "VELO", "VOITURE"]),
  zoneId: z.string().optional(),
});

export function publicRouter(prisma: PrismaClient, config: Config) {
  const router = Router();

  router.get("/zones", async (_req, res) => {
    const zones = await prisma.zone.findMany({
      where: { active: true },
      orderBy: { deliveryFee: "asc" },
      select: { id: true, name: true, deliveryFee: true, pricing: true },
    });
    res.json(zones);
  });

  // Règles d'annulation affichées aux clients.
  router.get("/policies", async (_req, res) => {
    const settings = await getSettings(prisma);
    res.json({
      freeCancellationMinutes: settings.freeCancellationMinutes,
      cancellationFeePercent: settings.cancellationFeePercent,
      whatsapp: config.zedekaWhatsapp,
    });
  });

  router.get("/parcel-categories", async (_req, res) => {
    res.json(
      await prisma.parcelCategory.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, surcharge: true, perKgFee: true },
      }),
    );
  });

  const customerId = (req: Request) => linkedCustomerId(prisma, req, config.secret);

  // Liste des restaurants pour l'application : ouverture, délai, frais pour la zone du client, minimum,
  // et recherche sur le nom du restaurant et des plats. Filtrage en mémoire (quelques dizaines de restaurants),
  // ce qui permet d'ignorer accents et casse.
  router.get("/restaurants", async (req, res) => {
    const zoneId = typeof req.query.zoneId === "string" ? req.query.zoneId : "";
    const q = fold(typeof req.query.q === "string" ? req.query.q : "");
    const [zone, restaurants] = await Promise.all([
      zoneId ? prisma.zone.findFirst({ where: { id: zoneId, active: true } }) : null,
      prisma.restaurant.findMany({
        where: { active: true, menuItems: { some: { available: true } } },
        orderBy: { name: "asc" },
        select: {
          slug: true,
          name: true,
          address: true,
          logoUrl: true,
          zoneId: true,
          deliveryTimeMin: true,
          deliveryTimeMax: true,
          minOrderAmount: true,
          active: true,
          temporarilyClosed: true,
          openingHours: true,
          menuItems: { where: { available: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, category: true, price: true, imageUrl: true } },
        },
      }),
    ]);
    const fee = zone ? { deliveryFee: zone.pricing === "DISTANCE" ? (zone.minFee ?? zone.deliveryFee) : zone.deliveryFee, feeFrom: zone.pricing === "DISTANCE" } : null;

    const list = restaurants
      .map((r) => {
        const nameMatch = !q || fold(r.name).includes(q);
        const dishes = q ? r.menuItems.filter((m) => fold(m.name).includes(q) || fold(m.category).includes(q)) : [];
        if (!nameMatch && dishes.length === 0) return null;
        const categories = [...new Set(r.menuItems.map((m) => m.category))].slice(0, 3);
        return {
          slug: r.slug,
          name: r.name,
          address: r.address,
          logoUrl: r.logoUrl,
          deliveryTimeMin: r.deliveryTimeMin,
          deliveryTimeMax: r.deliveryTimeMax,
          minOrderAmount: r.minOrderAmount,
          categories,
          availability: availability(r),
          sameZone: Boolean(zone && r.zoneId === zone.id),
          ...(fee ?? { deliveryFee: null, feeFrom: false }),
          dishes: dishes.slice(0, 3).map(({ category: _c, ...d }) => d),
        };
      })
      .filter((r) => r !== null)
      // Ouverts d'abord, puis ceux de la zone du client.
      .sort((a, b) => Number(b.availability.open) - Number(a.availability.open) || Number(b.sameZone) - Number(a.sameZone));
    res.json(list);
  });

  router.get("/restaurants/:slug", async (req, res) => {
    const restaurant = await prisma.restaurant.findFirst({
      where: { slug: req.params.slug, active: true },
      select: {
        slug: true,
        name: true,
        address: true,
        logoUrl: true,
        deliveryTimeMin: true,
        deliveryTimeMax: true,
        minOrderAmount: true,
        active: true,
        temporarilyClosed: true,
        openingHours: true,
        menuItems: {
          where: { available: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            category: true,
            name: true,
            description: true,
            price: true,
            imageUrl: true,
            variants: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, price: true } },
            addons: { where: { available: true }, select: { id: true, name: true, price: true } },
          },
        },
      },
    });
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    const { active: _a, temporarilyClosed: _t, ...rest } = restaurant;
    res.json({ ...rest, openingHours: parseHours(restaurant.openingHours), availability: availability(restaurant) });
  });

  router.post("/orders", async (req, res) => {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const input = parsed.data;
    if (input.fulfillment === "DELIVERY" && input.address.length < 5) {
      res.status(400).json({ error: "Adresse de livraison trop courte" });
      return;
    }

    const [restaurant, zone] = await Promise.all([
      prisma.restaurant.findFirst({ where: { slug: input.restaurantSlug, active: true } }),
      prisma.zone.findFirst({ where: { id: input.zoneId, active: true } }),
    ]);
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    if (!zone) {
      res.status(400).json({ error: "Zone de livraison inconnue" });
      return;
    }
    const open = availability(restaurant);
    if (!open.open) {
      res.status(409).json({ error: open.reason });
      return;
    }

    const menuItems = await prisma.menuItem.findMany({
      where: { restaurantId: restaurant.id, available: true, id: { in: input.items.map((i) => i.menuItemId) } },
      select: {
        id: true,
        name: true,
        price: true,
        variants: { select: { id: true, name: true, price: true } },
        addons: { where: { available: true }, select: { id: true, name: true, price: true } },
      },
    });

    const km =
      input.latitude !== undefined && input.longitude !== undefined && restaurant.latitude !== null && restaurant.longitude !== null
        ? Math.round(distanceKm(input as { latitude: number; longitude: number }, restaurant as { latitude: number; longitude: number }) * 10) / 10
        : null;
    const fee = input.fulfillment === "PICKUP" ? 0 : deliveryFee(zone, km);

    let priced;
    try {
      priced = priceOrder(input.items, menuItems, fee);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }

    if (priced.subtotal < restaurant.minOrderAmount) {
      res.status(400).json({ error: `Commande minimum : ${formatFcfa(restaurant.minOrderAmount)} (hors livraison)` });
      return;
    }

    const order = await createOrderWithCode(prisma, {
      type: "FOOD",
      customerId: await customerId(req),
      fulfillment: input.fulfillment,
      restaurantId: restaurant.id,
      zoneId: zone.id,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      address: input.fulfillment === "PICKUP" ? `À emporter chez ${restaurant.name}` : input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      distanceKm: km,
      note: input.note || null,
      paymentMethod: input.paymentMethod,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      total: priced.total,
      commission: Math.round((priced.subtotal * restaurant.commissionRate) / 100),
      items: { create: priced.lines },
    });

    const message = whatsappMessage({
      ...order,
      title: `Restaurant : ${restaurant.name}${input.fulfillment === "PICKUP" ? " (à emporter)" : ""}`,
      zoneName: zone.name,
      details: foodDetails(priced.lines),
    });
    res.status(201).json({ code: order.code, total: order.total, whatsappUrl: whatsappUrl(config.zedekaWhatsapp, message) });
  });

  router.post("/parcels", async (req, res) => {
    const parsed = parcelInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const input = parsed.data;
    const [zone, category] = await Promise.all([
      prisma.zone.findFirst({ where: { id: input.zoneId, active: true } }),
      prisma.parcelCategory.findFirst({ where: { id: input.parcelCategoryId, active: true } }),
    ]);
    if (!zone) {
      res.status(400).json({ error: "Zone de livraison inconnue" });
      return;
    }
    if (!category) {
      res.status(400).json({ error: "Catégorie de colis inconnue" });
      return;
    }

    const fee = deliveryFee(zone, null);
    const extraFee = parcelExtraFee(category, input.weightKg);
    const order = await createOrderWithCode(prisma, {
      type: "PARCEL",
      customerId: await customerId(req),
      zoneId: zone.id,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      pickupAddress: input.pickupAddress,
      address: input.address,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      parcelCategoryId: category.id,
      weightKg: input.weightKg,
      latitude: input.latitude,
      longitude: input.longitude,
      note: input.note || null,
      paymentMethod: input.paymentMethod,
      subtotal: 0,
      deliveryFee: fee,
      extraFee,
      total: fee + extraFee,
    });

    const message = whatsappMessage({
      ...order,
      title: `Colis : ${category.name}, ${input.weightKg} kg`,
      zoneName: zone.name,
      details: [
        `Retrait : ${input.pickupAddress}`,
        `Destinataire : ${input.recipientName}, ${input.recipientPhone}`,
        `Livraison : ${input.address}`,
      ],
    });
    res.status(201).json({
      code: order.code,
      total: order.total,
      breakdown: `${formatFcfa(fee)} + ${formatFcfa(extraFee)}`,
      whatsappUrl: whatsappUrl(config.zedekaWhatsapp, message),
    });
  });

  router.get("/orders/:code", async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { code: req.params.code },
      select: {
        code: true,
        type: true,
        fulfillment: true,
        status: true,
        subtotal: true,
        discount: true,
        deliveryFee: true,
        extraFee: true,
        total: true,
        paymentMethod: true,
        createdAt: true,
        restaurant: { select: { name: true } },
        zone: { select: { name: true } },
        items: { select: { name: true, variantName: true, addons: true, unitPrice: true, quantity: true } },
      },
    });
    if (!order) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    res.json(order);
  });

  router.post("/drivers/apply", async (req, res) => {
    const parsed = driverApplication.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const existing = await prisma.driver.findUnique({ where: { phone: parsed.data.phone } });
    if (existing) {
      res.status(409).json({ error: "Ce numéro est déjà enregistré" });
      return;
    }
    await prisma.driver.create({ data: { ...parsed.data, status: "PENDING", active: false } });
    res.status(201).json({ ok: true });
  });

  return router;
}
