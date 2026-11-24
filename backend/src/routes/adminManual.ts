// Saisie manuelle au back-office : une demande arrivée par téléphone, WhatsApp ou au bureau est enregistrée par
// l'équipe (directeur, adjoint, managerin, dispatcheur) comme si le client l'avait passée dans l'appli.
//   - course Zed (moto avec chauffeur) : le client est retrouvé, ou créé, par son numéro ;
//   - envoi de colis : même prix et même répartition qu'un colis de l'appli ;
//   - livraison de repas : plats choisis sur la carte du restaurant, qui l'accepte comme une commande de l'appli.
// Le canal d'origine (source) et le membre qui l'a saisie (createdBy) sont gardés sur la commande ou la course.
// Toutes les routes sont sous /orders/manual : les rôles qui ouvrent les commandes y ont accès (src/team.ts).
// Avec « preview: true », rien n'est créé : la route renvoie seulement le prix, pour l'afficher avant de valider.
import { type Request, type Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { normalizePhone } from "../customer.js";
import { foodDeliveryFee, foodDistanceKm, zoneForPoint } from "../delivery.js";
import type { Notifier } from "../notify.js";
import { availability } from "../openingHours.js";
import { priceParcel } from "../parcel.js";
import { foodDetails, formatFcfa, optionGroups, priceOrder } from "../pricing.js";
import { moduleOn, PARCEL_CLOSED } from "../services.js";
import { OutOfStock, takeStock } from "../stock.js";
import { staffName } from "../team.js";
import { createOrderWithCode, firstError, getSettings, phone } from "../util.js";
import { advanceRide, MAX_SCHEDULED, RIDE_OPEN, RIDE_SCHEDULED, rideCode, scheduleError } from "../zed.js";
import { HttpError } from "./adminWrite.js";
import { quoteTrip, type RoutingConfig } from "./zedApp.js";

// Canaux d'une demande saisie à la main : téléphone, WhatsApp, au bureau (client venu sur place), autre.
export const MANUAL_CHANNELS = ["PHONE", "WHATSAPP", "WALK_IN", "OTHER"] as const;
export const CHANNEL_LABEL: Record<(typeof MANUAL_CHANNELS)[number], string> = { PHONE: "téléphone", WHATSAPP: "WhatsApp", WALK_IN: "au bureau", OTHER: "autre canal" };

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const when = z.string().datetime({ offset: true });

const common = {
  channel: z.enum(MANUAL_CHANNELS, { errorMap: () => ({ message: "Indiquez d'où vient la demande (téléphone, WhatsApp…)" }) }),
  customerName: z.string().trim().min(2, "Nom du client : 2 caractères minimum").max(80),
  customerPhone: phone,
  note: z.string().trim().max(300).optional(),
  preview: z.boolean().default(false),
};

const parcelInput = z
  .object({
    ...common,
    pickupAddress: z.string().trim().max(300).default(""),
    pickupLatitude: lat.optional(),
    pickupLongitude: lng.optional(),
    pickupAt: when.optional(),
    address: z.string().trim().max(300).default(""),
    latitude: lat.optional(),
    longitude: lng.optional(),
    recipientName: z.string().trim().min(2, "Nom du destinataire : 2 caractères minimum").max(80),
    recipientPhone: phone,
    payer: z.enum(["SENDER", "RECIPIENT"]).default("SENDER"),
    paymentMethod: z.enum(["CASH", "MOBILE_MONEY"]).default("CASH"),
    parcelCategoryId: z.string().min(1, "Choisissez le type de colis"),
    weightKg: z.number().min(0).max(100),
    parcelSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).optional(),
  })
  .refine((p) => p.pickupAddress.length >= 3 || (p.pickupLatitude !== undefined && p.pickupLongitude !== undefined), { message: "Indiquez l'adresse ou la position du retrait" })
  .refine((p) => p.address.length >= 3 || (p.latitude !== undefined && p.longitude !== undefined), { message: "Indiquez l'adresse ou la position de livraison" });

const foodInput = z
  .object({
    ...common,
    restaurantId: z.string().min(1, "Choisissez le restaurant"),
    address: z.string().trim().max(300).default(""),
    latitude: lat.optional(),
    longitude: lng.optional(),
    paymentMethod: z.enum(["CASH", "MOBILE_MONEY"]).default("CASH"),
    items: z
      .array(
        z.object({
          menuItemId: z.string().min(1),
          quantity: z.number().int().min(1).max(50),
          variantId: z.string().optional(),
          addonIds: z.array(z.string()).max(20).optional(),
          choices: z.array(z.string().max(60)).max(10).optional(),
        }),
      )
      .min(1, "Ajoutez au moins un plat")
      .max(50),
  })
  .refine((p) => p.latitude !== undefined && p.longitude !== undefined, { message: "Placez le point de livraison sur la carte" });

const rideInput = z
  .object({
    ...common,
    latitude: lat,
    longitude: lng,
    landmark: z.string().trim().max(120).optional(),
    destination: z.string().trim().max(120).optional(),
    destinationLatitude: lat.optional(),
    destinationLongitude: lng.optional(),
    scheduledFor: when.optional(),
  })
  .refine((p) => (p.destinationLatitude === undefined) === (p.destinationLongitude === undefined), { message: "Position de la destination incomplète" });

const PARCEL_SIZE = { SMALL: "petit", MEDIUM: "moyen", LARGE: "grand" } as const;
const MOBILE_MONEY_OFF = "Le paiement mobile money n'est pas encore disponible : choisissez les espèces.";

// Message prêt à envoyer au client (WhatsApp), avec le lien de suivi quand il y en a un.
function customerMessage(name: string, to: string, text: string) {
  const hello = `Bonjour ${name.split(" ")[0]}, `;
  const full = hello + text;
  const digits = normalizePhone(to);
  return { text: full, whatsappUrl: `https://wa.me/${digits ? digits.slice(1) : to.replace(/\D/g, "")}?text=${encodeURIComponent(full)}` };
}

// Client inscrit avec ce numéro : la commande apparaît dans son historique.
async function accountFor(prisma: PrismaClient, raw: string) {
  const p = normalizePhone(raw);
  if (!p) return null;
  return (await prisma.customer.findFirst({ where: { phone: p, deletedAt: null }, select: { id: true } }))?.id ?? null;
}

const hhmm = (d: Date) => `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)} à ${d.toISOString().slice(11, 16)}`;

export function adminManualRouter(prisma: PrismaClient, config: { notifier: Notifier; frontendOrigin?: string; routing?: RoutingConfig }) {
  const router = Router();
  const { notifier } = config;
  const origin = (config.frontendOrigin ?? "").replace(/\/$/, "");
  const author = (res: Response) => staffName(res) ?? "Direction";

  const handle = (fn: (body: unknown, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req.body, res);
    } catch (e) {
      if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
      else if (e instanceof OutOfStock) res.status(409).json({ error: e.message });
      else throw e;
    }
  };
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, firstError(parsed.error));
    return parsed.data;
  }

  // Listes du formulaire : catégories de colis, restaurants et boutiques ouverts, services en marche.
  router.get("/orders/manual/options", async (_req, res) => {
    const [categories, restaurants, settings, parcelOn] = await Promise.all([
      prisma.parcelCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, surcharge: true, perKgFee: true } }),
      prisma.restaurant.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, address: true, phone: true } }),
      getSettings(prisma),
      moduleOn(prisma, "PARCEL"),
    ]);
    res.json({
      channels: MANUAL_CHANNELS,
      categories,
      restaurants,
      zedEnabled: !!settings.zedEnabled,
      parcelEnabled: parcelOn,
      mobileMoneyEnabled: !!settings.mobileMoneyEnabled,
    });
  });

  // Carte d'un restaurant pour composer la commande : plats disponibles, variantes, suppléments et choix.
  router.get("/orders/manual/menu/:restaurantId", async (req, res) => {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: String(req.params.restaurantId), active: true } });
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    const items = await prisma.menuItem.findMany({
      where: { restaurantId: restaurant.id, available: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        price: true,
        options: true,
        variants: { select: { id: true, name: true, price: true } },
        addons: { where: { available: true }, select: { id: true, name: true, price: true } },
      },
    });
    const open = availability(restaurant);
    res.json({
      restaurant: { id: restaurant.id, name: restaurant.name, minOrderAmount: restaurant.minOrderAmount, open: open.open, reason: open.open ? null : open.reason },
      items: items.map((i) => ({ ...i, options: optionGroups(i.options) })),
    });
  });

  // --- Envoi de colis ---
  router.post(
    "/orders/manual/parcel",
    handle(async (body, res) => {
      const input = parse(parcelInput, body);
      if (!(await moduleOn(prisma, "PARCEL"))) throw new HttpError(409, PARCEL_CLOSED);
      const now = new Date();
      const [category, settings] = await Promise.all([prisma.parcelCategory.findFirst({ where: { id: input.parcelCategoryId, active: true } }), getSettings(prisma)]);
      if (!category) throw new HttpError(400, "Catégorie de colis inconnue");
      const paymentMethod = input.payer === "RECIPIENT" ? "CASH" : input.paymentMethod;
      if (paymentMethod === "MOBILE_MONEY" && !settings.mobileMoneyEnabled) throw new HttpError(400, MOBILE_MONEY_OFF);
      const pickupAt = input.pickupAt ? new Date(input.pickupAt) : null;
      const wrongTime = pickupAt && scheduleError(pickupAt, now);
      if (wrongTime) throw new HttpError(400, wrongTime);
      const drop = input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : null;
      const pickup = { latitude: input.pickupLatitude ?? null, longitude: input.pickupLongitude ?? null };
      const { zoneId, zoneName, km, byZone, fee, extraFee } = await priceParcel(prisma, settings, pickup, drop, category, input.weightKg);
      const priceToConfirm = km === null && !byZone;
      const total = fee + extraFee;
      if (input.preview) {
        res.json({ deliveryFee: fee, extraFee, total, km, zone: zoneName, priceToConfirm });
        return;
      }
      const order = await createOrderWithCode(prisma, {
        type: "PARCEL",
        source: input.channel,
        createdBy: author(res),
        customerId: await accountFor(prisma, input.customerPhone),
        zoneId,
        distanceKm: km,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        pickupAddress: input.pickupAddress || "Position du retrait sur la carte",
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        pickupAt,
        address: input.address || "Position sur la carte",
        latitude: drop?.latitude ?? null,
        longitude: drop?.longitude ?? null,
        locationSource: drop ? "SENDER" : null,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        parcelCategoryId: category.id,
        weightKg: input.weightKg,
        parcelSize: input.parcelSize ?? null,
        note: input.note || null,
        paymentMethod,
        payer: input.payer,
        subtotal: 0,
        deliveryFee: fee,
        extraFee,
        total,
      });
      const where = [pickupAt ? `retrait le ${hhmm(pickupAt)}` : "", zoneName, km !== null ? `${km} km` : priceToConfirm ? "prix à confirmer" : ""].filter(Boolean).join(" · ");
      void notifier.staff("ORDERS", {
        title: `Colis ${order.code} (${CHANNEL_LABEL[input.channel]})`,
        body: `Saisi par ${author(res)}${where ? ` · ${where}` : ""} · ${formatFcfa(total)}`,
        url: `/admin/commandes/${order.id}`,
        tag: `order-${order.id}`,
        alarm: true,
      });
      const track = `${origin}/commande/${order.code}`;
      const toPay = input.payer === "RECIPIENT" ? `Le destinataire paie ${formatFcfa(total)} à la livraison.` : `À payer : ${formatFcfa(total)}.`;
      res.status(201).json({
        id: order.id,
        code: order.code,
        total,
        message: customerMessage(input.customerName, input.customerPhone, `votre envoi Zedeka ${order.code} est enregistré (${category.name}${input.parcelSize ? `, ${PARCEL_SIZE[input.parcelSize]}` : ""}). ${toPay} Suivez-le ici : ${track}`),
      });
    }),
  );

  // --- Livraison de repas (ou d'articles d'une boutique) ---
  router.post(
    "/orders/manual/food",
    handle(async (body, res) => {
      const input = parse(foodInput, body);
      const [restaurant, settings] = await Promise.all([prisma.restaurant.findFirst({ where: { id: input.restaurantId, active: true } }), getSettings(prisma)]);
      if (!restaurant) throw new HttpError(404, "Restaurant introuvable");
      if (input.paymentMethod === "MOBILE_MONEY" && !settings.mobileMoneyEnabled) throw new HttpError(400, MOBILE_MONEY_OFF);
      const open = availability(restaurant);
      if (!open.open) throw new HttpError(409, `${restaurant.name} : ${open.reason}`);
      const drop = { latitude: input.latitude!, longitude: input.longitude! };
      const zoneIds = [await zoneForPoint(prisma, drop), restaurant.zoneId].filter((id): id is string => !!id);
      const zones = zoneIds.length ? await prisma.zone.findMany({ where: { id: { in: zoneIds } } }) : [];
      const zone = zoneIds.map((id) => zones.find((z) => z.id === id)).find((z) => z !== undefined);
      if (!zone) throw new HttpError(400, "Zone de livraison inconnue : placez le client sur la carte");
      const km = foodDistanceKm({ point: drop, zone: null }, { point: restaurant, zone: zones.find((z) => z.id === restaurant.zoneId) });
      const fee = foodDeliveryFee(settings, km, zone);
      const menuItems = await prisma.menuItem.findMany({
        where: { restaurantId: restaurant.id, available: true, id: { in: input.items.map((i) => i.menuItemId) } },
        select: {
          id: true,
          name: true,
          price: true,
          variants: { select: { id: true, name: true, price: true } },
          addons: { where: { available: true }, select: { id: true, name: true, price: true } },
          options: true,
          stock: true,
        },
      });
      let priced;
      try {
        priced = priceOrder(input.items, menuItems, fee);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      if (priced.subtotal < restaurant.minOrderAmount) throw new HttpError(400, `Commande minimum : ${formatFcfa(restaurant.minOrderAmount)} (hors livraison)`);
      if (input.preview) {
        res.json({ subtotal: priced.subtotal, deliveryFee: priced.deliveryFee, total: priced.total, km, zone: zone.name });
        return;
      }
      const restoreStock = await takeStock(prisma, priced.lines, menuItems);
      const order = await createOrderWithCode(prisma, {
        type: "FOOD",
        fulfillment: "DELIVERY",
        source: input.channel,
        createdBy: author(res),
        customerId: await accountFor(prisma, input.customerPhone),
        restaurantId: restaurant.id,
        zoneId: zone.id,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        address: input.address || "Position sur la carte",
        latitude: drop.latitude,
        longitude: drop.longitude,
        locationSource: "SENDER",
        distanceKm: km,
        note: input.note || null,
        paymentMethod: input.paymentMethod,
        subtotal: priced.subtotal,
        deliveryFee: priced.deliveryFee,
        total: priced.total,
        commission: Math.round((priced.subtotal * restaurant.commissionRate) / 100),
        items: { create: priced.lines },
      }).catch(async (e) => {
        await restoreStock();
        throw e;
      });
      // Alarme chez le restaurant, qui accepte la commande comme une commande de l'appli.
      void notifier.push("restaurant", restaurant.id, {
        title: `Nouvelle commande ${order.code}`,
        body: `${formatFcfa(order.subtotal)} · ${zone.name}`,
        url: `/restaurant/commandes/${order.id}`,
        tag: `order-${order.id}`,
        alarm: true,
      });
      void notifier.staff("ORDERS", {
        title: `Commande ${order.code} (${CHANNEL_LABEL[input.channel]})`,
        body: `${restaurant.name} · saisie par ${author(res)} · ${formatFcfa(order.total)}`,
        url: `/admin/commandes/${order.id}`,
        tag: `order-${order.id}`,
      });
      const track = `${origin}/commande/${order.code}`;
      res.status(201).json({
        id: order.id,
        code: order.code,
        total: order.total,
        message: customerMessage(
          input.customerName,
          input.customerPhone,
          `votre commande ${restaurant.name} (${order.code}) est enregistrée : ${foodDetails(priced.lines).join(", ")}. À payer à la livraison : ${formatFcfa(order.total)}. Suivez-la ici : ${track}`,
        ),
      });
    }),
  );

  // --- Course Zed (moto avec chauffeur) ---
  router.post(
    "/orders/manual/ride",
    handle(async (body, res) => {
      const input = parse(rideInput, body);
      const s = await getSettings(prisma);
      if (!s.zedEnabled) throw new HttpError(409, "Le service Zed n'est pas encore ouvert");
      const customerPhone = normalizePhone(input.customerPhone);
      if (!customerPhone) throw new HttpError(400, "Numéro du client invalide : un numéro du Togo (8 chiffres) est nécessaire pour une course");
      const now = new Date();
      const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
      if (scheduledFor) {
        const wrong = scheduleError(scheduledFor, now);
        if (wrong) throw new HttpError(400, wrong);
        if (!input.destination) throw new HttpError(400, "Indiquez la destination pour réserver une course");
      }
      const from = { latitude: input.latitude, longitude: input.longitude };
      const to = input.destinationLatitude !== undefined && input.destinationLongitude !== undefined ? { latitude: input.destinationLatitude, longitude: input.destinationLongitude } : null;
      // Destination placée sur la carte : course demandée, au prix de l'itinéraire ; sinon le prix se fait sur place.
      const mode = to || scheduledFor ? "REQUEST" : "CALL";
      const trip = to ? await quoteTrip(prisma, config.routing ?? {}, from, to) : null;
      if (input.preview) {
        res.json({ price: trip?.price ?? null, distanceM: trip?.distanceM ?? null, durationS: trip?.durationS ?? null });
        return;
      }
      // Client retrouvé par son numéro, ou créé (il pourra ensuite s'inscrire avec ce même numéro).
      const existing = await prisma.customer.findUnique({ where: { phone: customerPhone }, select: { id: true, name: true, deletedAt: true } });
      const customer =
        existing && !existing.deletedAt
          ? existing.name
            ? existing
            : await prisma.customer.update({ where: { id: existing.id }, data: { name: input.customerName }, select: { id: true, name: true, deletedAt: true } })
          : await prisma.customer.create({ data: { phone: customerPhone, name: input.customerName }, select: { id: true, name: true, deletedAt: true } });
      if (scheduledFor) {
        if ((await prisma.zedRide.count({ where: { customerId: customer.id, status: RIDE_SCHEDULED } })) >= MAX_SCHEDULED) {
          throw new HttpError(409, `Ce client a déjà ${MAX_SCHEDULED} courses réservées`);
        }
      } else {
        const open = await prisma.zedRide.findFirst({ where: { customerId: customer.id, status: { in: [...RIDE_OPEN] } }, select: { code: true } });
        if (open) throw new HttpError(409, `Ce client a déjà une course en cours (${open.code})`);
      }
      const note = input.note ? ` · ${input.note}` : "";
      let ride = null;
      for (let attempt = 0; !ride; attempt++) {
        try {
          ride = await prisma.zedRide.create({
            data: {
              code: rideCode(),
              customerId: customer.id,
              latitude: from.latitude,
              longitude: from.longitude,
              // Repère lu par le conducteur : celui donné au téléphone, et la remarque de l'équipe.
              landmark: `${input.landmark || "Départ sur la carte"}${note}`.slice(0, 120),
              destination: input.destination || null,
              mode,
              destinationLatitude: to?.latitude ?? null,
              destinationLongitude: to?.longitude ?? null,
              distanceM: trip?.distanceM ?? null,
              quotedPrice: trip?.price ?? null,
              source: input.channel,
              createdBy: author(res),
              ...(scheduledFor ? { scheduledFor, status: RIDE_SCHEDULED } : {}),
            },
          });
        } catch (e) {
          if (attempt >= 4 || (e as { code?: string }).code !== "P2002") throw e;
        }
      }
      // Appel immédiat : le premier conducteur proche est alerté tout de suite ; la tâche de chaque minute fait
      // passer l'appel au suivant (src/zed.ts). Réservée : elle part 15 min avant l'heure.
      if (!scheduledFor) await advanceRide(prisma, notifier, ride.id, now, s);
      void notifier.staff("ORDERS", {
        title: `Course Zed ${ride.code} (${CHANNEL_LABEL[input.channel]})`,
        body: `Saisie par ${author(res)} · ${input.customerName}${scheduledFor ? ` · réservée le ${hhmm(scheduledFor)}` : ""}`,
        url: "/admin/zed",
        tag: `zed-${ride.id}`,
      });
      const price = trip ? ` Prix : ${formatFcfa(trip.price)}.` : " Le prix se fait avec le conducteur.";
      res.status(201).json({
        id: ride.id,
        code: ride.code,
        price: trip?.price ?? null,
        message: customerMessage(
          input.customerName,
          customerPhone,
          scheduledFor
            ? `votre course Zedeka ${ride.code} est réservée pour le ${hhmm(scheduledFor)}.${price}`
            : `nous cherchons un Zed près de vous (course ${ride.code}).${price} Le conducteur vous appelle dès qu'il accepte.`,
        ),
      });
    }),
  );

  // Courses saisies au bureau ces dernières 24 h : l'équipe suit si un conducteur a accepté.
  router.get("/orders/manual/rides", async (_req, res) => {
    const now = new Date();
    const rides = await prisma.zedRide.findMany({
      where: { source: { not: "APP" }, OR: [{ createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, { status: RIDE_SCHEDULED }] },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        code: true,
        status: true,
        source: true,
        createdBy: true,
        landmark: true,
        destination: true,
        quotedPrice: true,
        scheduledFor: true,
        createdAt: true,
        customer: { select: { name: true, phone: true } },
        driver: { select: { name: true, phone: true, plate: true } },
      },
    });
    res.json(rides);
  });

  return router;
}
