import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { hashPin, newPinInput, withoutPin } from "../pin.js";
import { DEPUTY_LOCKED_DRIVER_FIELDS, DIRECTOR_DRIVER_FIELDS, isDeputy, isDirector } from "../team.js";
import { z } from "zod";
import { PARCEL_ZONE_ID } from "../delivery.js";
import { OPEN } from "../orderFlow.js";
import { issueRestaurantLink, restaurantLocationLink, restaurantLocationState } from "../locationRequest.js";
import { getSettings, optionalEmail, phone, webUrl } from "../util.js";
import { HttpError, write } from "./adminWrite.js";

const slug = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "minuscules, chiffres et tirets");
const amount = z.number().int().min(0).max(1_000_000);
const url = webUrl.nullable();
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

// Création : la position est obligatoire. L'admin la place sur la carte, ou la demande au gérant par un lien ;
// dans ce cas le restaurant reste masqué aux clients jusqu'à ce qu'elle arrive.
const newRestaurantInput = restaurantInput.extend({ requestLocation: z.boolean().default(false) });

const NO_POSITION = "Placez le restaurant sur la carte, ou demandez sa position au gérant.";
const HIDDEN_WITHOUT_POSITION = "Le restaurant n'a pas encore de position : placez-le sur la carte avant de le rendre visible.";
const hasPoint = (p: { latitude?: number | null; longitude?: number | null }) => p.latitude != null && p.longitude != null;

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

// Une zone ne fixe plus de prix (repas et colis sont facturés au km, Réglages) : elle sert à placer les livreurs
// et à répartir les courses. Les anciennes colonnes de tarif restent en base, inutilisées.
const zoneInput = z.object({
  name: z.string().trim().min(2),
  // Centre de la zone, placé sur la carte : la zone d'un colis est celle du centre le plus proche.
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
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
  // Salarié de Zedeka : salaire mensuel, pas de part par course, courses attribuées d'office.
  employment: z.enum(["FREELANCE", "STAFF"]).default("FREELANCE"),
  monthlySalary: amount.nullable().default(null),
  // Code PIN de départ (ajout au back-office) ou nouveau PIN (livreur qui l'a oublié). Jamais renvoyé.
  pin: newPinInput.optional(),
  // Pour se connecter aussi avec l'e-mail et le PIN.
  email: optionalEmail.default(null),
});

// Le PIN est haché ; un nouveau PIN débloque aussi le compte après trop d'essais.
const pinData = async (pin: string | undefined) => (pin ? { pinHash: await hashPin(pin), pinAttempts: 0, pinLockedUntil: null } : {});

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
  parcelMinFee: z.number().int().min(0).max(1_000_000),
  parcelPerKmFee: z.number().int().min(0).max(100_000),
  parcelMaxFee: z.number().int().min(0).max(1_000_000),
  foodMinFee: z.number().int().min(0).max(1_000_000),
  foodPerKmFee: z.number().int().min(0).max(100_000),
  foodMaxFee: z.number().int().min(0).max(1_000_000),
  mobileMoneyEnabled: z.boolean(),
  depositAmount: z.number().int().min(0).max(1_000_000),
  depositLowThreshold: z.number().int().min(0).max(1_000_000),
});

export function adminCatalogRouter(prisma: PrismaClient, config: { frontendOrigin: string } = { frontendOrigin: "" }) {
  const router = Router();
  const locationRequest = { select: { status: true, expiresAt: true, respondedAt: true } } as const;
  const withState = <R extends Parameters<typeof restaurantLocationState>[0]>(r: R, now = new Date()) => {
    const { locationRequest: q, ...rest } = r;
    return { ...rest, locationState: restaurantLocationState(r, now), locationRequestExpiresAt: q?.expiresAt ?? null };
  };
  async function newLink(r: { id: string; name: string; phone: string }) {
    const { token, expiresAt } = await issueRestaurantLink(prisma, r.id, new Date());
    return restaurantLocationLink(config.frontendOrigin, token, r, expiresAt);
  }

  // --- Restaurants ---

  router.get("/restaurants", async (_req, res) => {
    res.json(
      await prisma.restaurant.findMany({
        orderBy: { name: "asc" },
        omit: { ownerPasswordHash: true, sessionsValidFrom: true },
        include: { zone: { select: { name: true } }, _count: { select: { orders: true, menuItems: true } }, locationRequest },
      }).then((list) => list.map((r) => withState(r))),
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
        locationRequest,
      },
    });
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    res.json(withState(restaurant));
  });

  // Identifiants de l'espace restaurant (le mot de passe n'est jamais renvoyé).
  router.put(
    "/restaurants/:id/access",
    write(
      z.object({ email: z.string().trim().toLowerCase().email("e-mail invalide"), password: z.string().min(8, "au moins 8 caractères") }),
      async (data, id) => {
        const r = await prisma.restaurant.update({
          where: { id },
          // Nouveau mot de passe : les sessions ouvertes avec l'ancien sont fermées.
          data: { ownerEmail: data.email, ownerPasswordHash: await bcrypt.hash(data.password, 10), sessionsValidFrom: new Date() },
        });
        return { ownerEmail: r.ownerEmail };
      },
    ),
  );

  router.post(
    "/restaurants",
    // Sans prix indiqué, le restaurant paie l'abonnement en vigueur.
    write(newRestaurantInput, async ({ requestLocation, ...data }) => {
      const placed = hasPoint(data);
      if (!placed && !requestLocation) throw new HttpError(400, NO_POSITION);
      const restaurant = await prisma.restaurant.create({
        data: {
          ...data,
          ...(placed ? {} : { latitude: null, longitude: null, active: false }),
          subscriptionFee: data.subscriptionFee === undefined ? (await getSettings(prisma)).vendorSubscriptionFee : data.subscriptionFee,
        },
        omit: { ownerPasswordHash: true, sessionsValidFrom: true },
      });
      if (placed) return restaurant;
      return { ...restaurant, locationLink: await newLink(restaurant) };
    }),
  );
  router.patch(
    "/restaurants/:id",
    write(
      restaurantInput,
      async (data, id) => {
        const current = await prisma.restaurant.findUnique({ where: { id }, select: { active: true, latitude: true, longitude: true } });
        if (!current) throw new HttpError(404, "Restaurant introuvable");
        const next = { ...current, ...data };
        // Une position ne s'efface pas : on la déplace. Et un restaurant sans position ne devient pas visible.
        if (hasPoint(current) && !hasPoint(next)) throw new HttpError(400, "La position du restaurant est obligatoire : déplacez-la plutôt que de l'effacer.");
        if (!hasPoint(next) && next.active && !current.active) throw new HttpError(400, HIDDEN_WITHOUT_POSITION);
        const restaurant = await prisma.restaurant.update({ where: { id }, data, omit: { ownerPasswordHash: true, sessionsValidFrom: true } });
        // Position placée par l'admin : le lien envoyé au gérant ne sert plus.
        if (data.latitude != null && data.longitude != null) {
          await prisma.locationRequest.updateMany({ where: { restaurantId: id, status: { in: ["PENDING", "OPENED"] } }, data: { status: "REVOKED" } });
        }
        return restaurant;
      },
      { partial: true },
    ),
  );

  // Lien pour que le gérant indique lui-même la position du restaurant (remplace le précédent).
  router.post("/restaurants/:id/location-link", async (req, res) => {
    const r = await prisma.restaurant.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, phone: true } });
    if (!r) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    res.status(201).json(await newLink(r));
  });

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
    res.json(await prisma.zone.findMany({ where: { id: { not: PARCEL_ZONE_ID } }, orderBy: { name: "asc" } }));
  });
  router.post(
    "/zones",
    write(zoneInput, (data) => prisma.zone.create({ data: { ...data, deliveryFee: 0 } })),
  );
  router.patch(
    "/zones/:id",
    write(
      zoneInput,
      async (data, id) => {
        const current = await prisma.zone.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "Zone introuvable");
        return prisma.zone.update({ where: { id }, data });
      },
      { partial: true },
    ),
  );

  // --- Livreurs ---

  router.get("/drivers", async (_req, res) => {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const [drivers, counts] = await Promise.all([
      prisma.driver.findMany({ where: { deletedAt: null }, orderBy: [{ status: "asc" }, { name: "asc" }], include: { zone: { select: { name: true } } } }),
      prisma.order.groupBy({
        by: ["driverId"],
        _count: { _all: true },
        where: { createdAt: { gte: today }, status: { not: "CANCELLED" }, driverId: { not: null } },
      }),
    ]);
    const director = isDirector(res);
    res.json(
      drivers.map(({ monthlySalary, ...d }) => ({ ...withoutPin(d), ...(director ? { monthlySalary } : {}), ordersToday: counts.find((c) => c.driverId === d.id)?._count._all ?? 0 })),
    );
  });
  router.post(
    "/drivers",
    write(driverInput, async ({ pin, ...data }, _id, res) => {
      if (!isDirector(res) && data.monthlySalary !== null) throw new HttpError(403, "Le salaire est réservé au directeur");
      return withoutPin(await prisma.driver.create({ data: { ...data, ...(await pinData(pin)) } }));
    }),
  );
  router.patch(
    "/drivers/:id",
    write(
      driverInput,
      async ({ pin, ...data }, id, res) => {
        if (isDeputy(res) && DEPUTY_LOCKED_DRIVER_FIELDS.some((f) => data[f] !== undefined)) {
          throw new HttpError(403, "Le salaire est réservé au directeur");
        }
        if (!isDirector(res) && !isDeputy(res) && DIRECTOR_DRIVER_FIELDS.some((f) => data[f] !== undefined)) {
          throw new HttpError(403, "Le nom, le numéro, l'e-mail, le statut salarié et le salaire sont réservés au directeur");
        }
        // Valider une candidature active le livreur ; la refuser le désactive.
        const extra = data.status === "APPROVED" ? { active: data.active ?? true } : data.status === "REJECTED" ? { active: false, online: false } : {};
        // Suspendu, refusé ou numéro changé : les sessions ouvertes sur ses téléphones sont fermées.
        // Une réactivation ne les rouvre pas, le livreur se reconnecte avec un code.
        const revoke = data.active === false || data.status === "REJECTED" || data.phone !== undefined ? { sessionsValidFrom: new Date() } : {};
        return withoutPin(await prisma.driver.update({ where: { id }, data: { ...data, ...extra, ...revoke, ...(await pinData(pin)) } }));
      },
      { partial: true },
    ),
  );

  // Supprimer un livreur (directeur seulement : la route n'est pas ouverte au dispatcheur).
  // Refusé tant qu'il a une course en cours ou des espèces à remettre. Sans aucun historique, il est effacé ;
  // sinon son compte est fermé et ses coordonnées (numéro, e-mail, PIN, positions) effacées, mais la ligne
  // reste pour que les commandes passées, les remises d'espèces et les rapports gardent son nom.
  router.delete("/drivers/:id", async (req, res) => {
    const id = String(req.params.id);
    const driver = await prisma.driver.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!driver || driver.deletedAt) {
      res.status(404).json({ error: "Livreur introuvable" });
      return;
    }
    const [ongoing, cashDue, orders, history] = await Promise.all([
      prisma.order.count({ where: { driverId: id, status: { in: OPEN } } }),
      prisma.order.count({ where: { driverId: id, status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null } }),
      prisma.order.count({ where: { driverId: id } }),
      Promise.all([
        prisma.driverAssignment.count({ where: { driverId: id } }),
        prisma.cashCollection.count({ where: { driverId: id } }),
        prisma.driverIssue.count({ where: { driverId: id } }),
      ]),
    ]);
    if (ongoing > 0) {
      res.status(409).json({ error: "Ce livreur a une course en cours. Réattribuez-la ou terminez-la avant de le supprimer." });
      return;
    }
    if (cashDue > 0) {
      res.status(409).json({ error: "Ce livreur a encore des espèces à remettre. Enregistrez la remise dans Finances avant de le supprimer." });
      return;
    }
    if (orders === 0 && history.every((n) => n === 0)) {
      await prisma.driverLocation.deleteMany({ where: { driverId: id } });
      await prisma.driver.delete({ where: { id } });
      res.json({ deleted: true, kept: false });
      return;
    }
    const now = new Date();
    await prisma.driverLocation.deleteMany({ where: { driverId: id } });
    await prisma.driver.update({
      where: { id },
      data: {
        deletedAt: now,
        active: false,
        online: false,
        // Numéro libéré (il est unique) : la personne pourra se réinscrire plus tard.
        phone: `supprime-${id}`,
        email: null,
        pinHash: null,
        pinAttempts: 0,
        pinLockedUntil: null,
        pinResetUntil: null,
        sessionsValidFrom: now,
        lastLatitude: null,
        lastLongitude: null,
        lastLocationAt: null,
        lastSeenAt: null,
        monthlySalary: null,
      },
    });
    res.json({ deleted: true, kept: true });
  });

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
