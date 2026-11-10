import { type Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { foodDeliveryFee, foodDistanceKm, nearestZone, PARCEL_ZONE_ID, pricingMode, zoneForPoint } from "../delivery.js";
import { availability, parseHours } from "../openingHours.js";
import { foodDetails, formatFcfa, normalizeCode, priceOrder, whatsappMessage, whatsappUrl } from "../pricing.js";
import { fold } from "../customer.js";
import { cuisinesOf } from "../cuisines.js";
import { livePromoWhere, normalizeCode as normalizePromoCode, promoDiscount, promoLabel, promoUses } from "../promo.js";
import { createOrderWithCode, firstError, getSettings, phone } from "../util.js";
import { linkedCustomerId } from "./customer.js";
import { priceParcel } from "../parcel.js";
import type { Notifier } from "../notify.js";
import { answerReceipt, newReceiptKey, RECEIPT_KEY_HEADER, receiptAllowed, receiptState } from "../receipt.js";
import { HttpError } from "./adminWrite.js";
import { moduleOn, PARCEL_CLOSED } from "../services.js";
import type { CatalogCache } from "../catalogCache.js";
import { isTableToken, tableAddress } from "../tables.js";
import { ADDRESS_FROM_RECIPIENT, hashLocationToken, isTokenShape, issueLocationLink, locationLink, locationStatus } from "../locationRequest.js";

type Config = { zedekaWhatsapp: string; secret: string; notifier: Notifier; frontendOrigin: string; catalog?: CatalogCache };

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
  // Envoi différé (hors ligne) : clé tirée par le téléphone, un second envoi ne crée pas de doublon.
  clientKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
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
  // Code promo saisi à la caisse (ou activé sur l'accueil) : la remise est recalculée ici.
  promoCode: z.string().trim().max(30).optional(),
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

// Données publiques qui changent rarement (zones, règles, catégories de colis) : gardées 60 s par le téléphone et par le
// point de présence Cloudflare (worker du site), puis resservies pendant 5 min le temps d'aller chercher la nouvelle version.
const PUBLIC_SHORT = "public, max-age=60, stale-while-revalidate=300";

export function publicRouter(prisma: PrismaClient, config: Config) {
  const router = Router();
  const cached: CatalogCache = config.catalog ?? ((_key, load) => load());

  router.get("/zones", async (_req, res) => {
    const zones = await prisma.zone.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      // deliveryFee : prix de la zone, appliqué quand les réglages facturent la livraison par zone.
      select: { id: true, name: true, latitude: true, longitude: true, deliveryFee: true },
    });
    res.set("Cache-Control", PUBLIC_SHORT);
    res.json(zones.filter((z) => z.id !== PARCEL_ZONE_ID));
  });

  // Règles d'annulation affichées aux clients.
  router.get("/policies", async (_req, res) => {
    const settings = await getSettings(prisma);
    res.set("Cache-Control", PUBLIC_SHORT);
    res.json({
      freeCancellationMinutes: settings.freeCancellationMinutes,
      cancellationFeePercent: settings.cancellationFeePercent,
      mobileMoneyEnabled: settings.mobileMoneyEnabled,
      // Repas : tarif au km entre le restaurant et le client (centre de sa zone si sa position est inconnue),
      // ou prix de la zone de livraison (mode ZONE).
      foodPricing: { mode: pricingMode(settings.foodPricingMode), minFee: settings.foodMinFee, perKmFee: settings.foodPerKmFee, maxFee: settings.foodMaxFee || null },
      whatsapp: config.zedekaWhatsapp,
    });
  });

  router.get("/parcel-categories", async (_req, res) => {
    res.set("Cache-Control", PUBLIC_SHORT);
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
    // Lectures de la base communes à tous les clients : gardées en mémoire quelques secondes (catalogCache.ts).
    // Frais, distances, ouverture et recherche sont calculés ensuite pour chaque visite.
    const [zones, settings, restaurants, ratings, shopPromos] = await cached("restaurants", () => Promise.all([
      prisma.zone.findMany({ where: { active: true, id: { not: PARCEL_ZONE_ID } }, select: { id: true, latitude: true, longitude: true, deliveryFee: true } }),
      getSettings(prisma),
      prisma.restaurant.findMany({
        where: { active: true, menuItems: { some: { available: true } } },
        orderBy: { name: "asc" },
        select: {
          id: true,
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
      // Notes laissées par les clients à la réception (1 à 5) : moyenne et nombre d'avis par restaurant.
      Promise.resolve()
        .then(() => prisma.order.groupBy({ by: ["restaurantId"], _avg: { restaurantRating: true }, _count: { restaurantRating: true }, where: { restaurantRating: { not: null } } }))
        .catch(() => []),
      // Remise propre à un restaurant (« -15 % ») : badge sur sa photo.
      Promise.resolve()
        .then(() => prisma.promo.findMany({ where: { ...livePromoWhere(new Date()), restaurantId: { not: null } }, select: { restaurantId: true, kind: true, value: true } }))
        .catch(() => []),
    ]));
    const badgeOf = new Map(shopPromos.map((p) => [p.restaurantId, p.kind === "PERCENT" ? `-${p.value} %` : p.kind === "FREE_DELIVERY" ? "Offerte" : `-${p.value} F`]));
    const ratingOf = new Map(ratings.map((g) => [g.restaurantId, { avg: Math.round((g._avg.restaurantRating ?? 0) * 10) / 10, count: g._count.restaurantRating }]));
    // Frais affichés : au km entre le restaurant et le client (ou le centre de sa zone) ; sinon « dès » le minimum.
    // Facturation par zone : prix de la zone du client (choisie, ou déduite de sa position) ; sinon « dès » le moins cher.
    const zone = zones.find((z) => z.id === zoneId);
    const byZone = pricingMode(settings.foodPricingMode) === "ZONE";
    const clientZone = zone ?? (byZone && client ? zones.find((z) => z.id === nearestZone(client, zones, restaurants)) : undefined);
    const cheapestZone = zones.length ? Math.min(...zones.map((z) => z.deliveryFee)) : settings.foodMinFee;
    const feeFor = (r: { latitude: number | null; longitude: number | null; zoneId: string | null }) => {
      if (byZone) return clientZone ? { deliveryFee: clientZone.deliveryFee, feeFrom: false } : { deliveryFee: cheapestZone, feeFrom: true };
      const km = foodDistanceKm({ point: client, zone }, { point: r, zone: zones.find((z) => z.id === r.zoneId) });
      return { deliveryFee: foodDeliveryFee(settings, km), feeFrom: km === null };
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
          cuisines: cuisinesOf(r.menuItems),
          // Photo de la carte du restaurant sur l'accueil : le premier plat qui en a une.
          coverUrl: r.menuItems.find((m) => m.imageUrl)?.imageUrl ?? null,
          rating: ratingOf.get(r.id) ?? null,
          promoBadge: badgeOf.get(r.id) ?? null,
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
    const found = await cached(`restaurant:${req.params.slug}`, () => restaurantPage(req.params.slug));
    if (!found) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    const { restaurant, stats, shopPromo } = found;
    const { id: _id, active: _a, temporarilyClosed: _t, closedUntil: _c, ...rest } = restaurant;
    const rating = stats?._count.restaurantRating ? { avg: Math.round((stats._avg.restaurantRating ?? 0) * 10) / 10, count: stats._count.restaurantRating } : null;
    res.json({
      ...rest,
      promo: shopPromo
        ? { code: shopPromo.code, title: shopPromo.title, label: promoLabel(shopPromo), kind: shopPromo.kind, value: shopPromo.value, maxDiscount: shopPromo.maxDiscount, minSubtotal: shopPromo.minSubtotal, endsAt: shopPromo.endsAt }
        : null,
      coverUrl: restaurant.menuItems.find((m) => m.imageUrl)?.imageUrl ?? null,
      rating,
      openingHours: parseHours(restaurant.openingHours),
      // Ouvert ou fermé : recalculé à chaque visite (l'heure change, pas la carte).
      availability: availability(restaurant),
    });
  });

  // Carte d'un restaurant lue dans la base : la fiche, puis la note et la promotion en parallèle.
  async function restaurantPage(slug: string) {
    const restaurant = await prisma.restaurant.findFirst({
      where: { slug, active: true },
      select: {
        id: true,
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
    if (!restaurant) return null;
    const [stats, shopPromo] = await Promise.all([
      // Note moyenne des clients (1 à 5) et nombre d'avis, sous le nom du restaurant.
      Promise.resolve()
        .then(() =>
          prisma.order.aggregate({ where: { restaurantId: restaurant.id, restaurantRating: { not: null } }, _avg: { restaurantRating: true }, _count: { restaurantRating: true } }),
        )
        .catch(() => null),
      // Promotion propre au restaurant : bandeau sous son nom, prix barrés quand c'est un pourcentage sans minimum.
      Promise.resolve()
        .then(() => prisma.promo.findFirst({ where: { ...livePromoWhere(new Date()), restaurantId: restaurant.id }, orderBy: { createdAt: "desc" } }))
        .catch(() => null),
    ]);
    return { restaurant, stats, shopPromo };
  }

  // Envoi déjà reçu avec cette clé (réponse perdue, ou envoi au retour du réseau répété) : on renvoie la commande
  // existante. Sans compte, la clé du reçu est remplacée, puisque la première n'est jamais arrivée au téléphone.
  async function alreadySent(clientKey: string | undefined) {
    if (!clientKey) return null;
    const o = await prisma.order.findUnique({ where: { clientKey }, select: { id: true, code: true, total: true, tableNumber: true, customerId: true } });
    if (!o) return null;
    const guestKey = o.customerId ? null : newReceiptKey();
    if (guestKey) await prisma.order.update({ where: { id: o.id }, data: { receiptKeyHash: guestKey.hash } });
    return { code: o.code, total: o.total, tableNumber: o.tableNumber, receiptKey: guestKey?.key ?? null, duplicate: true };
  }

  // Zone rattachée à une commande à emporter ou sur place (aucune livraison) : voir la route /orders.
  async function pickupZone(restaurant: { zoneId: string | null; latitude: number | null; longitude: number | null }) {
    const own = restaurant.zoneId ? await prisma.zone.findUnique({ where: { id: restaurant.zoneId } }) : null;
    if (own) return own;
    const near =
      restaurant.latitude !== null && restaurant.longitude !== null ? await zoneForPoint(prisma, { latitude: restaurant.latitude, longitude: restaurant.longitude }) : null;
    return (
      (near && (await prisma.zone.findUnique({ where: { id: near } }))) ??
      (await prisma.zone.findFirst({ where: { active: true, id: { not: PARCEL_ZONE_ID } } })) ??
      (await prisma.zone.findFirst())
    );
  }

  router.post("/orders", async (req, res) => {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const input = parsed.data;
    const sent = await alreadySent(input.clientKey);
    if (sent) {
      res.json(sent);
      return;
    }
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
    // À emporter ou sur place : aucune zone de livraison n'est demandée au client. La commande garde une zone pour
    // les statistiques : celle du restaurant (même désactivée), sinon la plus proche de lui, sinon une zone existante.
    const zone = zoneIds.map((id) => zones.find((z) => z.id === id)).find((z) => z !== undefined) ?? (delivery ? undefined : await pickupZone(restaurant));
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
    // Facturation par zone (réglages) : prix de la zone de livraison retenue ci-dessus.
    const fee = delivery ? foodDeliveryFee(settings, km, zone) : 0;

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

    const owner = await customerId(req);
    // Code promo : vérifié et calculé ici, quel que soit l'aperçu montré à la caisse.
    let promo: { id: string; code: string; payer: string; discount: number } | null = null;
    if (input.promoCode) {
      const code = normalizePromoCode(input.promoCode);
      const rule = await prisma.promo.findUnique({ where: { code } });
      if (!rule) {
        res.status(400).json({ error: "Code promo inconnu" });
        return;
      }
      const uses = await promoUses(prisma, rule.id, { customerId: owner, phone: input.customerPhone ?? "" });
      const r = promoDiscount(rule, { subtotal: priced.subtotal, deliveryFee: priced.deliveryFee, restaurantId: restaurant.id, ...uses }, now);
      if ("error" in r) {
        res.status(400).json({ error: r.error });
        return;
      }
      // Remise payée par Zedeka : seulement quand Zedeka encaisse (livraison, ou paiement mobile money).
      if (rule.payer !== "RESTAURANT" && (table || (input.fulfillment === "PICKUP" && input.paymentMethod === "CASH"))) {
        res.status(400).json({ error: "Ce code vaut pour la livraison, ou un retrait payé par mobile money" });
        return;
      }
      promo = { id: rule.id, code: rule.code, payer: rule.payer, discount: r.discount };
    }
    // Sans compte : clé de suivi pour cet appareil seulement (voir receiptAllowed).
    const guestKey = owner ? null : newReceiptKey();
    const order = await createOrderWithCode(prisma, {
      type: "FOOD",
      customerId: owner,
      receiptKeyHash: guestKey?.hash ?? null,
      clientKey: input.clientKey ?? null,
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
      discount: promo?.discount ?? 0,
      total: priced.total - (promo?.discount ?? 0),
      promoId: promo?.id ?? null,
      promoCode: promo?.code ?? null,
      promoPayer: promo?.payer ?? null,
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
    res.status(201).json({ code: order.code, total: order.total, tableNumber: order.tableNumber, receiptKey: guestKey?.key ?? null, whatsappUrl: whatsappUrl(config.zedekaWhatsapp, message) });
  });

  // Offres de l'accueil (« Offres pour vous ») : codes actifs marqués « afficher sur l'accueil ».
  router.get("/promos", async (_req, res) => {
    const promos = await prisma.promo.findMany({
      where: { ...livePromoWhere(new Date()), showOnHome: true },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { code: true, title: true, kind: true, value: true, maxDiscount: true, minSubtotal: true, endsAt: true, restaurant: { select: { slug: true, name: true } } },
    });
    res.json(promos.map((p) => ({ ...p, label: promoLabel(p) })));
  });

  // Aperçu d'un code à la caisse : remise sur le panier en cours (la commande la recalcule).
  router.post("/promos/check", async (req, res) => {
    const parsed = z
      .object({ code: z.string().trim().min(1).max(30), restaurantSlug: z.string().min(1), subtotal: z.number().int().min(0).max(10_000_000), deliveryFee: z.number().int().min(0).max(1_000_000).default(0), customerPhone: z.string().max(20).optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Code promo invalide" });
      return;
    }
    const { code, restaurantSlug, subtotal, deliveryFee, customerPhone } = parsed.data;
    const [rule, restaurant] = await Promise.all([
      prisma.promo.findUnique({ where: { code: normalizePromoCode(code) } }),
      prisma.restaurant.findFirst({ where: { slug: restaurantSlug, active: true }, select: { id: true } }),
    ]);
    if (!rule || !restaurant) {
      res.status(404).json({ error: "Code promo inconnu" });
      return;
    }
    const uses = await promoUses(prisma, rule.id, { customerId: await customerId(req), phone: customerPhone ?? "" });
    const r = promoDiscount(rule, { subtotal, deliveryFee, restaurantId: restaurant.id, ...uses });
    if ("error" in r) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.json({ code: rule.code, discount: r.discount, label: rule.title || promoLabel(rule), payer: rule.payer });
  });

  // QR code d'une table : restaurant et numéro, pour ouvrir la carte en mode « sur place ».
  router.get("/tables/:token", async (req, res) => {
    const table = isTableToken(req.params.token)
      ? await prisma.restaurantTable.findUnique({ where: { token: req.params.token }, select: { number: true, restaurant: { select: { slug: true, name: true, active: true, tableCallsEnabled: true } } } })
      : null;
    if (!table || !table.restaurant.active) {
      res.status(404).json({ error: "Table introuvable" });
      return;
    }
    res.json({ number: table.number, restaurant: { slug: table.restaurant.slug, name: table.restaurant.name }, calls: table.restaurant.tableCallsEnabled !== false });
  });

  router.post("/parcels", async (req, res) => {
    const parsed = parcelInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const input = parsed.data;
    const sent = await alreadySent(input.clientKey);
    if (sent) {
      res.json(sent);
      return;
    }
    // Module « Colis » coupé dans l'admin : plus de nouveaux colis, même si l'appli affichait encore le bouton.
    if (!(await moduleOn(prisma, "PARCEL"))) {
      res.status(409).json({ error: PARCEL_CLOSED });
      return;
    }
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
    const { zoneId, zoneName, km, byZone, fee, extraFee } = await priceParcel(prisma, settings, { latitude: input.pickupLatitude ?? null, longitude: input.pickupLongitude ?? null }, drop, category, input.weightKg);
    // Adresse écrite sans les deux positions (et sans prix de zone) : tarif minimum, que Zedeka confirme.
    const priceToConfirm = km === null && !waiting && !byZone;
    const address = input.address || (request?.landmark ? `Repère : ${request.landmark}` : ADDRESS_FROM_RECIPIENT);
    const owner = await customerId(req);
    const guestKey = owner ? null : newReceiptKey();
    const order = await createOrderWithCode(prisma, {
      type: "PARCEL",
      distanceKm: km,
      customerId: owner,
      receiptKeyHash: guestKey?.hash ?? null,
      clientKey: input.clientKey ?? null,
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
      receiptKey: guestKey?.key ?? null,
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
    res.json({ mode: pricingMode(s.parcelPricingMode), minFee: s.parcelMinFee, perKmFee: s.parcelPerKmFee, maxFee: s.parcelMaxFee || null });
  });

  // Zone d'une position (point placé, lien collé, position partagée), pour remplir le formulaire.
  router.get("/zones/locate", async (req, res) => {
    const p = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180) }).safeParse(req.query);
    const zoneId = p.success ? await zoneForPoint(prisma, p.data) : null;
    res.json({ zoneId });
  });

  // Commandes passées sans compte depuis cet appareil (historique de l'appli) : un seul appel pour toutes, au lieu
  // d'un par commande. Mêmes informations que le suivi public par code, réduites au résumé de la liste.
  router.get("/orders/summaries", async (req, res) => {
    const codes = [...new Set(String(req.query.codes ?? "").split(",").map((c) => normalizeCode(c)).filter(Boolean))].slice(0, 10);
    if (!codes.length) {
      res.json([]);
      return;
    }
    const orders = await prisma.order.findMany({
      where: { code: { in: codes } },
      select: {
        code: true,
        type: true,
        status: true,
        total: true,
        createdAt: true,
        restaurant: { select: { name: true } },
        zone: { select: { name: true } },
        items: { select: { name: true, quantity: true } },
      },
    });
    res.json(orders);
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
        // Récapitulatif : code promo, distance du trajet, qui paie et type du colis (rien de personnel).
        promoCode: true,
        distanceKm: true,
        payer: true,
        parcelCategory: { select: { name: true } },
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
    const { locationRequest, parcelCategory, ...rest } = order;
    const position = locationStatus(locationRequest, order.status, new Date());
    res.json({ ...rest, category: parcelCategory?.name ?? null, locationStatus: position, awaitingPosition: (position === "PENDING" || position === "DECLINED") && order.status === "PENDING", driver: order.driver && { firstName: order.driver.name.split(" ")[0], vehicle: order.driver.vehicle } });
  });

  // Clôture par le client : état, code à donner au livreur, confirmation de réception et notes.
  // Commande rattachée à un compte : seul ce compte voit le code et répond (le livreur connaît le code de la commande).
  async function receiptOrder(req: Request) {
    const order = await prisma.order.findUnique({ where: { code: normalizeCode(String(req.params.code)) }, include: { driver: { select: { name: true } }, restaurant: { select: { name: true } } } });
    if (!order) throw new HttpError(404, "Commande introuvable");
    const key = req.get(RECEIPT_KEY_HEADER);
    const allowed = receiptAllowed(order, order.customerId ? await customerId(req) : null, key);
    return { order, allowed };
  }

  // Détail de la livraison pour la page de suivi : adresses, destinataire, colis, qui paie, plaque du livreur.
  // Réservé à qui a passé la commande (même règle que la clôture) : la page de suivi s'ouvre avec le seul code.
  router.get("/orders/:code/details", async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { code: normalizeCode(req.params.code) },
      select: {
        type: true,
        customerId: true,
        receiptKeyHash: true,
        customerName: true,
        customerPhone: true,
        address: true,
        note: true,
        distanceKm: true,
        pickupAddress: true,
        payer: true,
        locationSource: true,
        recipientName: true,
        recipientPhone: true,
        weightKg: true,
        parcelSize: true,
        parcelCategory: { select: { name: true } },
        status: true,
        latitude: true,
        longitude: true,
        pickupLatitude: true,
        pickupLongitude: true,
        restaurant: { select: { name: true, address: true, latitude: true, longitude: true } },
        driver: { select: { id: true, name: true, plate: true, vehicle: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true } },
      },
    });
    if (!order) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    if (!receiptAllowed(order, order.customerId ? await customerId(req) : null, req.get(RECEIPT_KEY_HEADER))) {
      res.status(403).json({ error: "Détail visible depuis le compte qui a commandé" });
      return;
    }
    const parcel = order.type === "PARCEL";
    res.json({
      sender: { name: order.customerName, phone: maskPhone(order.customerPhone) },
      pickupAddress: parcel ? order.pickupAddress : null,
      // Repas : le départ est le restaurant (« Depuis » du suivi).
      from: !parcel && order.restaurant ? { name: order.restaurant.name, address: order.restaurant.address } : null,
      address: order.address === ADDRESS_FROM_RECIPIENT ? null : order.address,
      note: order.note,
      distanceKm: order.distanceKm,
      recipient: parcel && order.recipientName ? { name: order.recipientName, phone: order.recipientPhone ? maskPhone(order.recipientPhone) : null } : null,
      locationSource: order.locationSource,
      payer: parcel ? order.payer : null,
      category: order.parcelCategory?.name ?? null,
      weightKg: order.weightKg,
      parcelSize: order.parcelSize,
      driverPlate: order.driver?.plate ?? null,
      // Carte du suivi : départ (restaurant ou retrait du colis), arrivée, et le livreur seulement pendant le trajet.
      map: {
        from: point(parcel ? order.pickupLatitude : order.restaurant?.latitude, parcel ? order.pickupLongitude : order.restaurant?.longitude),
        to: point(order.latitude, order.longitude),
        driver:
          order.status === "PICKED_UP" && order.driver?.lastLocationAt && Date.now() - order.driver.lastLocationAt.getTime() < LIVE_MS
            ? { ...point(order.driver.lastLatitude, order.driver.lastLongitude)!, at: order.driver.lastLocationAt }
            : null,
      },
      // Carte du livreur : prénom, véhicule, plaque, note moyenne et nombre de livraisons faites.
      driver: order.driver ? { firstName: order.driver.name.split(" ")[0], vehicle: order.driver.vehicle, plate: order.driver.plate, ...(await driverStats(order.driver.id)) } : null,
    });
  });

  async function driverStats(driverId: string) {
    const [rated, deliveries] = await Promise.all([
      Promise.resolve()
        .then(() => prisma.order.aggregate({ where: { driverId, driverRating: { not: null } }, _avg: { driverRating: true }, _count: { driverRating: true } }))
        .catch(() => null),
      Promise.resolve()
        .then(() => prisma.order.count({ where: { driverId, status: "DELIVERED" } }))
        .catch(() => 0),
    ]);
    const rating = rated?._count.driverRating ? Math.round((rated._avg.driverRating ?? 0) * 10) / 10 : null;
    return { rating, deliveries };
  }

  router.get("/orders/:code/receipt", async (req, res) => {
    try {
      const { order, allowed } = await receiptOrder(req);
      const state = receiptState(order);
      res.json({
        state,
        allowed,
        // Sans compte : la réponse se fait depuis l'appareil qui a commandé.
        guest: !order.customerId,
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
      if (!allowed) throw new HttpError(403, order.customerId ? "Connectez-vous avec le compte qui a passé la commande" : "Répondez depuis le téléphone qui a passé la commande");
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

// Numéro à moitié masqué pour l'écran : indicatif, deux premiers et deux derniers chiffres.
// Position du livreur montrée au client tant qu'elle a moins de 10 minutes.
const LIVE_MS = 10 * 60_000;
const point = (latitude: number | null | undefined, longitude: number | null | undefined) =>
  latitude != null && longitude != null ? { latitude, longitude } : null;

export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 6) return "••";
  const local = d.slice(-8);
  const prefix = d.length > 8 ? `+${d.slice(0, d.length - 8)} ` : "";
  return `${prefix}${local.slice(0, 2)} •• •• ${local.slice(-2)}`;
}
