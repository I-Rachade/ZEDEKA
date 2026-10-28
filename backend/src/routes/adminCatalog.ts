import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getSettings, phone } from "../util.js";
import { HttpError, write } from "./adminWrite.js";

const slug = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "minuscules, chiffres et tirets");
const amount = z.number().int().min(0).max(1_000_000);
const url = z.string().trim().url("lien invalide").max(500).nullable();
const optionalId = z.string().min(1).nullable();

const restaurantInput = z.object({
  slug,
  name: z.string().trim().min(2),
  phone,
  address: z.string().trim().min(2),
  commissionRate: z.number().int().min(0).max(50).default(0), // abonnement fixe par défaut, sans commission
  subscriptionFee: z.number().int().min(0).max(1_000_000).nullable().optional(),
  active: z.boolean().default(true),
  zoneId: optionalId.default(null),
  deliveryTimeMin: z.number().int().min(5).max(180).default(20),
  deliveryTimeMax: z.number().int().min(5).max(240).default(40),
  logoUrl: url.default(null),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
});

export const menuItemInput = z.object({
  category: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().max(300).nullish(),
  price: amount,
  imageUrl: url.default(null),
  available: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const variantsInput = z.object({
  variants: z.array(z.object({ name: z.string().trim().min(1).max(60), price: amount })).max(20),
});
export const itemAddonsInput = z.object({ addonIds: z.array(z.string()).max(30) });
export const addonInput = z.object({ name: z.string().trim().min(1).max(60), price: amount, available: z.boolean().default(true) });

const zoneInput = z.object({
  name: z.string().trim().min(2),
  pricing: z.enum(["FIXED", "DISTANCE"]).default("FIXED"),
  deliveryFee: amount,
  minFee: amount.nullable().default(null),
  perKmFee: amount.nullable().default(null),
  maxFee: amount.nullable().default(null),
  active: z.boolean().default(true),
});

const driverInput = z.object({
  name: z.string().trim().min(2),
  phone,
  active: z.boolean().default(true),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("APPROVED"),
  online: z.boolean().default(false),
  vehicle: z.enum(["MOTO", "VELO", "VOITURE"]).default("MOTO"),
  zoneId: optionalId.default(null),
});

const parcelCategoryInput = z.object({
  name: z.string().trim().min(2),
  surcharge: amount.default(0),
  perKgFee: amount.default(0),
  active: z.boolean().default(true),
});

const percent = z.number().int().min(0).max(100);
const settingsInput = z.object({
  parcelDriverCommission: percent,
  foodDriverCommission: percent,
  freeCancellationMinutes: z.number().int().min(0).max(240),
  cancellationFeePercent: percent,
  vendorSubscriptionFee: z.number().int().min(0).max(1_000_000),
});

function checkZonePricing(z: { pricing?: string; perKmFee?: number | null; minFee?: number | null; maxFee?: number | null }) {
  if (z.pricing === "DISTANCE" && !z.perKmFee) throw new HttpError(400, "Indiquez le prix par km");
  if (z.minFee && z.maxFee && z.minFee > z.maxFee) throw new HttpError(400, "Le minimum dépasse le maximum");
}

export function adminCatalogRouter(prisma: PrismaClient) {
  const router = Router();

  // --- Restaurants ---

  router.get("/restaurants", async (_req, res) => {
    res.json(
      await prisma.restaurant.findMany({
        orderBy: { name: "asc" },
        omit: { ownerPasswordHash: true, sessionsValidFrom: true },
        include: { zone: { select: { name: true } }, _count: { select: { orders: true, menuItems: true } } },
      }),
    );
  });

  router.get("/restaurants/:id", async (req, res) => {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.params.id },
      omit: { ownerPasswordHash: true, sessionsValidFrom: true },
      include: {
        menuItems: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: { variants: { orderBy: { sortOrder: "asc" } }, addons: { select: { id: true } } },
        },
        addons: { orderBy: { name: "asc" } },
      },
    });
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    res.json(restaurant);
  });

  // Identifiants de l'espace restaurant (le mot de passe n'est jamais renvoyé).
  router.put(
    "/restaurants/:id/access",
    write(
      z.object({ email: z.string().trim().toLowerCase().email("e-mail invalide"), password: z.string().min(8, "au moins 8 caractères") }),
      async (data, id) => {
        const r = await prisma.restaurant.update({
          where: { id },
          data: { ownerEmail: data.email, ownerPasswordHash: await bcrypt.hash(data.password, 10) },
        });
        return { ownerEmail: r.ownerEmail };
      },
    ),
  );

  router.post(
    "/restaurants",
    // Sans prix indiqué, le restaurant paie l'abonnement en vigueur.
    write(restaurantInput, async (data) =>
      prisma.restaurant.create({
        data: { ...data, subscriptionFee: data.subscriptionFee === undefined ? (await getSettings(prisma)).vendorSubscriptionFee : data.subscriptionFee },
        omit: { ownerPasswordHash: true, sessionsValidFrom: true },
      }),
    ),
  );
  router.patch(
    "/restaurants/:id",
    write(
      restaurantInput,
      (data, id) => prisma.restaurant.update({ where: { id }, data, omit: { ownerPasswordHash: true, sessionsValidFrom: true } }),
      { partial: true },
    ),
  );

  // --- Plats, variantes, suppléments ---

  router.post(
    "/restaurants/:id/items",
    write(menuItemInput, (data, id) => prisma.menuItem.create({ data: { ...data, restaurantId: id } })),
  );
  router.patch(
    "/items/:id",
    write(menuItemInput, (data, id) => prisma.menuItem.update({ where: { id }, data }), { partial: true }),
  );

  // Remplace toute la liste des variantes d'un plat.
  router.put(
    "/items/:id/variants",
    write(
      variantsInput,
      async (data, id) => {
        await prisma.menuVariant.deleteMany({ where: { menuItemId: id } });
        await prisma.menuVariant.createMany({
          data: data.variants.map((v, i) => ({ ...v, sortOrder: i, menuItemId: id })),
        });
        return prisma.menuVariant.findMany({ where: { menuItemId: id }, orderBy: { sortOrder: "asc" } });
      },
      { partial: true },
    ),
  );

  router.put(
    "/items/:id/addons",
    write(
      itemAddonsInput,
      async (data, id) => {
        const item = await prisma.menuItem.findUnique({ where: { id } });
        if (!item) throw new HttpError(404, "Plat introuvable");
        const addons = await prisma.addon.findMany({ where: { id: { in: data.addonIds }, restaurantId: item.restaurantId } });
        return prisma.menuItem.update({
          where: { id },
          data: { addons: { set: addons.map((a) => ({ id: a.id })) } },
          include: { addons: { select: { id: true } } },
        });
      },
      { partial: true },
    ),
  );

  router.post(
    "/restaurants/:id/addons",
    write(addonInput, (data, id) => prisma.addon.create({ data: { ...data, restaurantId: id } })),
  );
  router.patch("/addons/:id", write(addonInput, (data, id) => prisma.addon.update({ where: { id }, data }), { partial: true }));

  // --- Zones ---

  router.get("/zones", async (_req, res) => {
    res.json(await prisma.zone.findMany({ orderBy: { deliveryFee: "asc" } }));
  });
  router.post(
    "/zones",
    write(zoneInput, (data) => {
      checkZonePricing(data);
      return prisma.zone.create({ data });
    }),
  );
  router.patch(
    "/zones/:id",
    write(
      zoneInput,
      async (data, id) => {
        const current = await prisma.zone.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "Zone introuvable");
        checkZonePricing({ ...current, ...data });
        return prisma.zone.update({ where: { id }, data });
      },
      { partial: true },
    ),
  );

  // --- Livreurs ---

  router.get("/drivers", async (_req, res) => {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const [drivers, counts] = await Promise.all([
      prisma.driver.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { zone: { select: { name: true } } } }),
      prisma.order.groupBy({
        by: ["driverId"],
        _count: { _all: true },
        where: { createdAt: { gte: today }, status: { not: "CANCELLED" }, driverId: { not: null } },
      }),
    ]);
    res.json(drivers.map((d) => ({ ...d, ordersToday: counts.find((c) => c.driverId === d.id)?._count._all ?? 0 })));
  });
  router.post("/drivers", write(driverInput, (data) => prisma.driver.create({ data })));
  router.patch(
    "/drivers/:id",
    write(
      driverInput,
      (data, id) => {
        // Valider une candidature active le livreur ; la refuser le désactive.
        const extra = data.status === "APPROVED" ? { active: data.active ?? true } : data.status === "REJECTED" ? { active: false, online: false } : {};
        return prisma.driver.update({ where: { id }, data: { ...data, ...extra } });
      },
      { partial: true },
    ),
  );

  // --- Colis ---

  router.get("/parcel-categories", async (_req, res) => {
    res.json(await prisma.parcelCategory.findMany({ orderBy: { name: "asc" } }));
  });
  router.post("/parcel-categories", write(parcelCategoryInput, (data) => prisma.parcelCategory.create({ data })));
  router.patch(
    "/parcel-categories/:id",
    write(parcelCategoryInput, (data, id) => prisma.parcelCategory.update({ where: { id }, data }), { partial: true }),
  );

  // --- Réglages ---

  router.get("/settings", async (_req, res) => {
    res.json(await getSettings(prisma));
  });
  router.patch(
    "/settings",
    write(
      settingsInput,
      async (data) => {
        await getSettings(prisma);
        return prisma.settings.update({ where: { id: 1 }, data });
      },
      { partial: true },
    ),
  );

  return router;
}
