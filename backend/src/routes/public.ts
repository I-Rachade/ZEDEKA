import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { deliveryFee, distanceKm, parcelExtraFee } from "../delivery.js";
import { foodDetails, formatFcfa, priceOrder, whatsappMessage, whatsappUrl } from "../pricing.js";
import { createOrderWithCode, firstError, phone } from "../util.js";

type Config = { zedekaWhatsapp: string };

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

  router.get("/parcel-categories", async (_req, res) => {
    res.json(
      await prisma.parcelCategory.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, surcharge: true, perKgFee: true },
      }),
    );
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
    res.json(restaurant);
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

    const order = await createOrderWithCode(prisma, {
      type: "FOOD",
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
