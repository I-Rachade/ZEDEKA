import { type Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { foodDistanceKm, foodFee, parcelDistanceKm, parcelExtraFee, parcelFee, PARCEL_ZONE_ID, zoneForPoint } from "../delivery.js";
import { availability, parseHours } from "../openingHours.js";
import { foodDetails, formatFcfa, normalizeCode, priceOrder, whatsappMessage, whatsappUrl } from "../pricing.js";
import { fold } from "../customer.js";
import { createOrderWithCode, firstError, getSettings, phone } from "../util.js";
import { linkedCustomerId } from "./customer.js";
import type { Notifier } from "../notify.js";
import { answerReceipt, receiptState } from "../receipt.js";
import { HttpError } from "./adminWrite.js";
import { isTableToken, tableAddress } from "../tables.js";
import { ADDRESS_FROM_RECIPIENT, hashLocationToken, isTokenShape, issueLocationLink, locationLink, locationStatus } from "../locationRequest.js";

type Config = { zedekaWhatsapp: string; secret: string; notifier: Notifier; frontendOrigin: string };

const coords = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
};

// Case « J'accepte les conditions… » : obligatoire, son heure est gardée comme preuve.
const TERMS_REQUIRED = "Acceptez les conditions générales et la politique de confidentialité pour continuer";
export const acceptTerms = z.literal(true, { errorMap: () => ({ message: TERMS_REQUIRED }) });

const customer = {
  acceptTerms,
  zoneId: z.string().min(1),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: phone,
  note: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(["CASH", "MOBILE_MONEY"]),
  ...coords,
};

// Repas : comme pour les colis, le point de livraison est une position (la mienne, placée sur la carte, tirée d'un
// lien Google Maps, ou partagée par la personne livrée via un lien). La zone s'en déduit ; l'adresse écrite n'est
// plus qu'un repère facultatif. Une zone et une adresse écrite, sans position, restent acceptées (anciens écrans).
const orderInput = z.object({
  ...customer,
  zoneId: z.string().optional(),
  restaurantSlug: z.string().min(1),
  fulfillment: z.enum(["DELIVERY", "PICKUP"]).default("DELIVERY"),
  address: z.string().trim().max(300).default(""),
  // Repas pour quelqu'un d'autre : clé de la demande de position, dont la réponse doit être arrivée.
  locationRequestKey: z.string().optional(),
  // Commande sur place : lien du QR code de la table. Numéro facultatif (le client est à table).
  tableToken: z.string().optional(),
  customerPhone: z.union([phone, z.literal("")]).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(50),
        variantId: z.string().optional(),
        addonIds: z.array(z.string()).max(20).optional(),
      }),
    )
    .min(1, "Le panier est vide")
    .max(50, "Panier trop grand"),
});

// Colis : pour le retrait comme pour la livraison, une adresse écrite ou une position suffit. Le prix vient de la
// distance entre les deux positions, au tarif des réglages ; la zone, obligatoire, se déduit de la position de livraison.
const parcelInput = z
  .object({
    ...customer,
    // Jamais choisie par le client : déduite de la position.
    zoneId: z.string().optional(),
    pickupAddress: z.string().trim().max(300).default(""),
    pickupLatitude: z.number().min(-90).max(90).optional(),
    pickupLongitude: z.number().min(-180).max(180).optional(),
    address: z.string().trim().max(300).default(""),
    // Demande de position faite depuis le formulaire (clé de suivi), ou à faire après la commande.
    locationRequestKey: z.string().optional(),
    askRecipientLocation: z.boolean().default(false),
    recipientName: z.string().trim().min(2).max(80),
    recipientPhone: phone,
    // Qui paie : l'expéditeur, ou le destinataire en espèces à la livraison.
    payer: z.enum(["SENDER", "RECIPIENT"]).default("SENDER"),
    parcelCategoryId: z.string().min(1),
    weightKg: z.number().min(0).max(100),
    parcelSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).optional(),
  })
  .refine((p) => p.pickupAddress.length >= 3 || (p.pickupLatitude !== undefined && p.pickupLongitude !== undefined), { message: "Indiquez l'adresse ou la position du retrait" })
  .refine((p) => p.address.length >= 3 || (p.latitude !== undefined && p.longitude !== undefined) || !!p.locationRequestKey || p.askRecipientLocation, {
    message: "Indiquez l'adresse ou la position du destinataire",
  });

const MOBILE_MONEY_OFF = "Le paiement mobile money n'est pas encore disponible : choisissez les espèces.";

const PARCEL_SIZE = { SMALL: "petit", MEDIUM: "moyen", LARGE: "grand" } as const;

export function publicRouter(prisma: PrismaClient, config: Config) {
  const router = Router();

  router.get("/zones", async (_req, res) => {
    const zones = await prisma.zone.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, latitude: true, longitude: true },
    });
    res.json(zones.filter((z) => z.id !== PARCEL_ZONE_ID));
  });

  // Règles d'annulation affichées aux clients.
  router.get("/policies", async (_req, res) => {
    const settings = await getSettings(prisma);
    res.json({
      freeCancellationMinutes: settings.freeCancellationMinutes,
      cancellationFeePercent: settings.cancellationFeePercent,
      mobileMoneyEnabled: settings.mobileMoneyEnabled,
      // Repas : tarif au km entre le restaurant et le client (centre de sa zone si sa position est inconnue).
      foodPricing: { minFee: settings.foodMinFee, perKmFee: settings.foodPerKmFee, maxFee: settings.foodMaxFee || null },
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

  // Liste des restaurants pour l'application : ouverture, délai, frais (au km depuis la position du client, sinon
  // depuis le centre de sa zone), minimum,
  // et recherche sur le nom du restaurant et des plats. Filtrage en mémoire (quelques dizaines de restaurants),
  // ce qui permet d'ignorer accents et casse.
  router.get("/restaurants", async (req, res) => {
    const zoneId = typeof req.query.zoneId === "string" ? req.query.zoneId : "";
    const q = fold(typeof req.query.q === "string" ? req.query.q : "");
    const at = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180) }).safeParse(req.query);
    const client = at.success ? at.data : null;
    const [zones, settings, restaurants] = await Promise.all([
      prisma.zone.findMany({ where: { active: true }, select: { id: true, latitude: true, longitude: true } }),
      getSettings(prisma),
      prisma.restaurant.findMany({
        where: { active: true, menuItems: { some: { available: true } } },
        orderBy: { name: "asc" },
        select: {
          slug: true,
          name: true,
          address: true,
          logoUrl: true,
          zoneId: true,
          latitude: true,
          longitude: true,
          deliveryTimeMin: true,
          deliveryTimeMax: true,
          minOrderAmount: true,
          active: true,
          temporarilyClosed: true,
          closedUntil: true,
          openingHours: true,
          menuItems: { where: { available: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, category: true, price: true, imageUrl: true } },
        },
      }),
    ]);
    // Frais affichés : au km entre le restaurant et le client (ou le centre de sa zone) ; sinon « dès » le minimum.
    const zone = zones.find((z) => z.id === zoneId);
    const feeFor = (r: { latitude: number | null; longitude: number | null; zoneId: string | null }) => {
      const km = foodDistanceKm({ point: client, zone }, { point: r, zone: zones.find((z) => z.id === r.zoneId) });
      return { deliveryFee: foodFee(settings, km), feeFrom: km === null };
    };

    const list = restaurants
      .map((r) => {
        const nameMatch = !q || fold(r.name).includes(q);
        const dishes = q ? r.menuItems.filter((m) => fold(m.name).includes(q) || fold(m.category).includes(q)) : [];
        if (!nameMatch && dishes.length === 0) return null;
        const categories = [...new Set(r.menuItems.map((m) => m.category))];
        return {
          slug: r.slug,
          name: r.name,
          address: r.address,
          logoUrl: r.logoUrl,
          latitude: r.latitude,
          longitude: r.longitude,
          deliveryTimeMin: r.deliveryTimeMin,
          deliveryTimeMax: r.deliveryTimeMax,
          minOrderAmount: r.minOrderAmount,
          categories,
          availability: availability(r),
          sameZone: Boolean(zone && r.zoneId === zone.id),
          ...feeFor(r),
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
        latitude: true,
        longitude: true,
        zone: { select: { id: true, name: true } },
        deliveryTimeMin: true,
        deliveryTimeMax: true,
        minOrderAmount: true,
        active: true,
        temporarilyClosed: true,
        closedUntil: true,
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
    const { active: _a, temporarilyClosed: _t, closedUntil: _c, ...rest } = restaurant;
    res.json({ ...rest, openingHours: parseHours(restaurant.openingHours), availability: availability(restaurant) });
  });

  router.post("/orders", async (req, res) => {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const input = parsed.data;
    const table =
      input.tableToken === undefined
        ? null
        : isTableToken(input.tableToken)
          ? await prisma.restaurantTable.findUnique({ where: { token: input.tableToken }, include: { restaurant: { select: { slug: true } } } })
          : null;
    if (input.tableToken !== undefined && (!table || table.restaurant.slug !== input.restaurantSlug)) {
      res.status(400).json({ error: "Ce QR code de table n'est plus valable : demandez-en un nouveau au restaurant." });
      return;
    }
    if (!table && !input.customerPhone) {
      res.status(400).json({ error: "Numéro de téléphone invalide" });
      return;
    }
    // Sur place : servie à la table, sans livreur, comme une commande à emporter.
    if (table) input.fulfillment = "PICKUP";
    const delivery = input.fulfillment === "DELIVERY";
    const now = new Date();
    const request =
      delivery && input.locationRequestKey
        ? isTokenShape(input.locationRequestKey)
          ? await prisma.locationRequest.findFirst({ where: { pollKeyHash: hashLocationToken(input.locationRequestKey), orderId: null, expiresAt: { gt: now } } })
          : null
        : undefined;
    if (request === null) {
      res.status(400).json({ error: "Le lien de position a expiré : créez-en un nouveau, ou placez le point vous-même." });
      return;
    }
    // Le repas ne peut pas attendre : la position demandée doit être arrivée avant la commande.
    const shared = request && request.status === "SHARED" && request.latitude !== null && request.longitude !== null ? { latitude: request.latitude, longitude: request.longitude } : null;
    if (request && !shared) {
      res.status(400).json({ error: "La position n'a pas encore été partagée : attendez la réponse, ou placez le point vous-même." });
      return;
    }
    const placed = input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : null;
    const drop = delivery ? (shared ?? placed) : null;
    if (delivery && !drop && (input.address.length < 5 || !input.zoneId)) {
      res.status(400).json({ error: "Indiquez le point de livraison : votre position, un point sur la carte, un lien Google Maps, ou un lien envoyé à la personne livrée." });
      return;
    }

    const [restaurant, settings] = await Promise.all([prisma.restaurant.findFirst({ where: { slug: input.restaurantSlug, active: true } }), getSettings(prisma)]);
    if (input.paymentMethod === "MOBILE_MONEY" && !settings.mobileMoneyEnabled) {
      res.status(400).json({ error: MOBILE_MONEY_OFF });
      return;
    }
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    // Zone : celle du point de livraison, sinon celle choisie (anciens écrans), sinon celle du restaurant.
    const zoneIds = [drop && (await zoneForPoint(prisma, drop)), input.zoneId, restaurant.zoneId].filter((id): id is string => !!id);
    const zones = zoneIds.length ? await prisma.zone.findMany({ where: { id: { in: zoneIds }, active: true } }) : [];
    const zone = zoneIds.map((id) => zones.find((z) => z.id === id)).find((z) => z !== undefined);
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

    // Prix au km entre le restaurant et le point de livraison (tarif repas des réglages). Position inconnue d'un
    // côté : centre de la zone choisie par le client, ou de la zone du restaurant ; sinon le minimum.
    const restaurantZone = zones.find((z) => z.id === restaurant.zoneId);
    const km = foodDistanceKm({ point: drop, zone: zone.id === input.zoneId ? zone : null }, { point: restaurant, zone: restaurantZone });
    const fee = delivery ? foodFee(settings, km) : 0;

    let priced;
    try {
      priced = priceOrder(input.items, menuItems, fee);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }

    // Le minimum de commande vaut pour la livraison et l'emporter, pas pour un client assis à table.
    if (!table && priced.subtotal < restaurant.minOrderAmount) {
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
      customerPhone: input.customerPhone ?? "",
      termsAcceptedAt: now,
      tableNumber: table?.number ?? null,
      address: table
        ? tableAddress(table.number, restaurant.name)
        : !delivery
        ? `À emporter chez ${restaurant.name}`
        : input.address || (request?.landmark ? `Repère : ${request.landmark}` : shared ? "Position partagée par la personne livrée" : "Position sur la carte"),
      latitude: drop?.latitude ?? null,
      longitude: drop?.longitude ?? null,
      locationSource: shared ? "RECIPIENT" : drop ? "SENDER" : null,
      distanceKm: km,
      note: input.note || null,
      paymentMethod: input.paymentMethod,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      total: priced.total,
      // Sur place : pas de commission, le restaurant paie déjà son abonnement mensuel.
      commission: table ? 0 : Math.round((priced.subtotal * restaurant.commissionRate) / 100),
      items: { create: priced.lines },
    });

    // La demande de position suit la commande (coordonnées effacées 30 jours après la livraison, comme pour les colis).
    if (request) await prisma.locationRequest.update({ where: { id: request.id }, data: { orderId: order.id } });

    // Alarme chez le restaurant (et pour la répartition), même si son panneau est fermé.
    void config.notifier.push("restaurant", restaurant.id, {
      title: `Nouvelle commande ${order.code}`,
      body: `${formatFcfa(order.subtotal)} · ${table ? `table ${table.number}` : input.fulfillment === "PICKUP" ? "à emporter" : zone.name}`,
      url: `/restaurant/commandes/${order.id}`,
      tag: `order-${order.id}`,
      alarm: true,
    });
    void config.notifier.staff("ORDERS", { title: `Commande ${order.code}`, body: `${restaurant.name} · ${formatFcfa(order.total)}`, url: `/admin/commandes/${order.id}`, tag: `order-${order.id}` });

    const message = whatsappMessage({
      ...order,
      title: `Restaurant : ${restaurant.name}${table ? ` (sur place, table ${table.number})` : input.fulfillment === "PICKUP" ? " (à emporter)" : ""}`,
      zoneName: [zone.name, km !== null ? `${km} km` : ""].filter(Boolean).join(", "),
      details: foodDetails(priced.lines),
    });
    res.status(201).json({ code: order.code, total: order.total, tableNumber: order.tableNumber, whatsappUrl: whatsappUrl(config.zedekaWhatsapp, message) });
  });

  // QR code d'une table : restaurant et numéro, pour ouvrir la carte en mode « sur place ».
  router.get("/tables/:token", async (req, res) => {
    const table = isTableToken(req.params.token)
      ? await prisma.restaurantTable.findUnique({ where: { token: req.params.token }, select: { number: true, restaurant: { select: { slug: true, name: true, active: true } } } })
      : null;
    if (!table || !table.restaurant.active) {
      res.status(404).json({ error: "Table introuvable" });
      return;
    }
    res.json({ number: table.number, restaurant: { slug: table.restaurant.slug, name: table.restaurant.name } });
  });

  router.post("/parcels", async (req, res) => {
    const parsed = parcelInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const input = parsed.data;
    const now = new Date();
    const [category, settings, request] = await Promise.all([
      prisma.parcelCategory.findFirst({ where: { id: input.parcelCategoryId, active: true } }),
      getSettings(prisma),
      input.locationRequestKey && isTokenShape(input.locationRequestKey)
        ? prisma.locationRequest.findFirst({ where: { pollKeyHash: hashLocationToken(input.locationRequestKey), orderId: null, expiresAt: { gt: now } } })
        : null,
    ]);
    if (!category) {
      res.status(400).json({ error: "Catégorie de colis inconnue" });
      return;
    }
    // Le destinataire paie en espèces, au livreur, à la livraison.
    const paymentMethod = input.payer === "RECIPIENT" ? "CASH" : input.paymentMethod;
    if (paymentMethod === "MOBILE_MONEY" && !settings.mobileMoneyEnabled) {
      res.status(400).json({ error: MOBILE_MONEY_OFF });
      return;
    }
    if (input.locationRequestKey && !request) {
      res.status(400).json({ error: "Le lien de position a expiré : demandez-en un nouveau, ou indiquez l'adresse." });
      return;
    }

    // Point de livraison : position déjà partagée par le destinataire, sinon celle placée ou collée par l'expéditeur.
    const shared = request?.status === "SHARED" && request.latitude !== null && request.longitude !== null ? { latitude: request.latitude, longitude: request.longitude } : null;
    const placed = input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : null;
    const drop = shared ?? placed;
    // En attente : demande au destinataire sans réponse, et ni point placé ni adresse pour livrer.
    const waiting = !drop && (!!request || input.askRecipientLocation);
    // Zone : déduite de la position de livraison. Sans position (attendue, ou adresse écrite seule), ou hors des zones
    // connues, « Zone à déterminer » : la répartition l'attribue.
    const zoneId = (drop && (await zoneForPoint(prisma, drop))) || PARCEL_ZONE_ID;
    if (zoneId === PARCEL_ZONE_ID) await prisma.zone.upsert({ where: { id: PARCEL_ZONE_ID }, update: {}, create: { id: PARCEL_ZONE_ID, name: "Zone à déterminer", pricing: "DISTANCE", deliveryFee: 0, active: false } });
    const km = parcelDistanceKm({ latitude: input.pickupLatitude ?? null, longitude: input.pickupLongitude ?? null }, { latitude: drop?.latitude ?? null, longitude: drop?.longitude ?? null });
    const fee = parcelFee(settings, km);
    // Adresse écrite sans les deux positions : tarif minimum, que Zedeka confirme.
    const priceToConfirm = km === null && !waiting;
    const extraFee = parcelExtraFee(category, input.weightKg);
    const address = input.address || (request?.landmark ? `Repère : ${request.landmark}` : ADDRESS_FROM_RECIPIENT);
    const order = await createOrderWithCode(prisma, {
      type: "PARCEL",
      distanceKm: km,
      customerId: await customerId(req),
      zoneId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      termsAcceptedAt: now,
      pickupAddress: input.pickupAddress || "Position du retrait sur la carte",
      pickupLatitude: input.pickupLatitude ?? null,
      pickupLongitude: input.pickupLongitude ?? null,
      address,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      parcelCategoryId: category.id,
      weightKg: input.weightKg,
      parcelSize: input.parcelSize ?? null,
      latitude: drop?.latitude ?? null,
      longitude: drop?.longitude ?? null,
      locationSource: shared ? "RECIPIENT" : placed ? "SENDER" : null,
      note: input.note || null,
      paymentMethod,
      payer: input.payer,
      subtotal: 0,
      deliveryFee: fee,
      extraFee,
      total: fee + extraFee,
    });
    // La demande faite depuis le formulaire suit la commande : sans réponse, la commande l'attend (24 h au plus).
    // Point placé par l'expéditeur entre-temps : la demande ne compte plus.
    if (request) await prisma.locationRequest.update({ where: { id: request.id }, data: { orderId: order.id, ...(placed && !shared ? { status: "REVOKED" } : {}) } });

    // En attente de la position du destinataire : simple information, l'alarme sonnera à sa réception.
    const zoneName = zoneId === PARCEL_ZONE_ID ? "" : ((await prisma.zone.findUnique({ where: { id: zoneId }, select: { name: true } }))?.name ?? "");
    const where = [zoneName, km !== null ? `${km} km` : priceToConfirm ? "prix à confirmer (adresse écrite)" : ""].filter(Boolean).join(" · ");
    void config.notifier.staff("ORDERS", {
      title: `Colis ${order.code}`,
      body: waiting ? "En attente de la position du destinataire" : `${where ? `${where} · ` : ""}${formatFcfa(order.total)}`,
      url: `/admin/commandes/${order.id}`,
      tag: `order-${order.id}`,
      alarm: !waiting,
    });

    const message = whatsappMessage({
      ...order,
      title: `Colis : ${category.name}, ${input.weightKg} kg${input.parcelSize ? `, ${PARCEL_SIZE[input.parcelSize]}` : ""}`,
      zoneName: [zoneName, km !== null ? `${km} km` : "à confirmer"].filter(Boolean).join(", "),
      payer: input.payer,
      details: [
        `Retrait : ${order.pickupAddress}`,
        `Destinataire : ${input.recipientName}, ${input.recipientPhone}`,
        `Livraison : ${address}`,
      ],
    });
    // Ancien parcours (lien demandé à la commande) : lien renvoyé une seule fois, seule son empreinte est gardée.
    const link = !request && waiting ? await issueLocationLink(prisma, order.id, now) : null;
    res.status(201).json({
      code: order.code,
      total: order.total,
      breakdown: `${formatFcfa(fee)} + ${formatFcfa(extraFee)}`,
      whatsappUrl: whatsappUrl(config.zedekaWhatsapp, message),
      locationLink: link && locationLink(config.frontendOrigin, link.token, order, link.expiresAt),
      // Prix fixé à la réception de la position du destinataire ; d'ici là, la commande attend.
      awaitingPosition: waiting,
      priceToConfirm,
    });
  });

  // Tarif des colis, pour afficher le prix dans le formulaire (même calcul que l'API).
  router.get("/parcel-pricing", async (_req, res) => {
    const s = await getSettings(prisma);
    res.json({ minFee: s.parcelMinFee, perKmFee: s.parcelPerKmFee, maxFee: s.parcelMaxFee || null });
  });

  // Zone d'une position (point placé, lien collé, position partagée), pour remplir le formulaire.
  router.get("/zones/locate", async (req, res) => {
    const p = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180) }).safeParse(req.query);
    const zoneId = p.success ? await zoneForPoint(prisma, p.data) : null;
    res.json({ zoneId });
  });

  router.get("/orders/:code", async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { code: normalizeCode(req.params.code) },
      select: {
        code: true,
        type: true,
        fulfillment: true,
        tableNumber: true,
        status: true,
        subtotal: true,
        discount: true,
        deliveryFee: true,
        extraFee: true,
        total: true,
        paymentMethod: true,
        createdAt: true,
        // Heures des étapes et livreur, pour la page de suivi (frise et heure d'arrivée estimée).
        confirmedAt: true,
        preparingAt: true,
        prepMinutes: true,
        readyAt: true,
        pickedUpAt: true,
        deliveredAt: true,
        handedOverAt: true,
        cancelledAt: true,
        driver: { select: { name: true, vehicle: true } },
        restaurant: { select: { name: true, deliveryTimeMin: true, deliveryTimeMax: true } },
        zone: { select: { name: true } },
        items: { select: { name: true, variantName: true, addons: true, unitPrice: true, quantity: true } },
        refundDue: true,
        edits: { orderBy: { createdAt: "asc" }, select: { reason: true, changes: true, oldTotal: true, newTotal: true, refund: true, createdAt: true } },
        locationRequest: { select: { status: true, expiresAt: true } },
      },
    });
    if (!order) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    // Seul le prénom du livreur est montré : la page est accessible avec le seul code.
    // État de la demande de position au destinataire, sans les coordonnées.
    const { locationRequest, ...rest } = order;
    const position = locationStatus(locationRequest, order.status, new Date());
    res.json({ ...rest, locationStatus: position, awaitingPosition: (position === "PENDING" || position === "DECLINED") && order.status === "PENDING", driver: order.driver && { firstName: order.driver.name.split(" ")[0], vehicle: order.driver.vehicle } });
  });

  // Clôture par le client : état, code à donner au livreur, confirmation de réception et notes.
  // Commande rattachée à un compte : seul ce compte voit le code et répond (le livreur connaît le code de la commande).
  async function receiptOrder(req: Request) {
    const order = await prisma.order.findUnique({ where: { code: normalizeCode(String(req.params.code)) }, include: { driver: { select: { name: true } }, restaurant: { select: { name: true } } } });
    if (!order) throw new HttpError(404, "Commande introuvable");
    const allowed = !order.customerId || (await customerId(req)) === order.customerId;
    return { order, allowed };
  }

  router.get("/orders/:code/receipt", async (req, res) => {
    try {
      const { order, allowed } = await receiptOrder(req);
      const state = receiptState(order);
      res.json({
        state,
        allowed,
        handedOverAt: order.handedOverAt,
        deliveryCode: allowed && order.status === "PICKED_UP" ? order.deliveryCode : null,
        driverFirstName: order.driver?.name.split(" ")[0] ?? null,
        restaurantName: order.type === "FOOD" ? (order.restaurant?.name ?? null) : null,
        driverRating: order.driverRating,
        restaurantRating: order.restaurantRating,
      });
    } catch (e) {
      if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
      else throw e;
    }
  });

  const rating = z.number().int().min(1, "Choisissez une note de 1 à 5").max(5);
  const receiptInput = z.discriminatedUnion("received", [
    z.object({ received: z.literal(true), driverRating: rating, restaurantRating: rating.optional(), comment: z.string().trim().max(500).optional() }),
    z.object({ received: z.literal(false), note: z.string().trim().min(3, "Dites-nous ce qui s'est passé").max(500) }),
  ]);

  router.post("/orders/:code/receipt", async (req, res) => {
    const parsed = receiptInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const { order, allowed } = await receiptOrder(req);
      if (!allowed) throw new HttpError(403, "Connectez-vous avec le compte qui a passé la commande");
      await answerReceipt(prisma, config.notifier, order, parsed.data);
      res.json({ ok: true, state: receiptState((await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))) });
    } catch (e) {
      if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
      else throw e;
    }
  });

  // Suivi d'une commande passée sans compte : code + numéro de téléphone (client, expéditeur ou destinataire).
  router.post("/track", async (req, res) => {
    const parsed = z.object({ code: z.string().trim().min(4).max(20), phone: z.string().trim().min(8).max(20) }).safeParse(req.body);
    const tail = parsed.success ? parsed.data.phone.replace(/\D/g, "").slice(-8) : "";
    if (!parsed.success || tail.length < 8) {
      res.status(400).json({ error: "Indiquez le code de la commande et le numéro utilisé" });
      return;
    }
    const code = normalizeCode(parsed.data.code);
    const matches = (...phones: (string | null)[]) => phones.some((p) => p && p.replace(/\D/g, "").slice(-8) === tail);
    const order = await prisma.order.findUnique({ where: { code }, select: { code: true, type: true, customerPhone: true, recipientPhone: true } });
    if (order && matches(order.customerPhone, order.recipientPhone)) {
      res.json({ kind: order.type, code: order.code });
      return;
    }
    // Même réponse que le code existe ou non, pour ne pas révéler les codes.
    res.status(404).json({ error: "Aucune commande ne correspond à ce code et ce numéro" });
  });

  return router;
}
