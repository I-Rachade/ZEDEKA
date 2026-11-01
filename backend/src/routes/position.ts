import { type Request, Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { type ParcelTariff, parcelDistanceKm, parcelFee, zoneForPoint } from "../delivery.js";
import { addressWithLandmark, firstName, hashLocationToken, isTokenShape, issueLocationLink, issueStandaloneLink, linkUsable, locationLink } from "../locationRequest.js";
import { resolveMapsLink } from "../mapsLink.js";
import { searchPlaces } from "../places.js";
import type { Notifier } from "../notify.js";
import { formatFcfa, normalizeCode } from "../pricing.js";
import { firstError, getSettings } from "../util.js";
import { linkedCustomerId } from "./customer.js";

type Config = { secret: string; notifier: Notifier; frontendOrigin: string };

// Même réponse pour un lien inconnu, échu ou remplacé : on ne révèle pas ce qui existe.
const GONE = "Ce lien n'est plus valable. Contactez la personne qui vous envoie le colis.";
// Une seule réponse par livraison : une fois la position reçue, le lien ne l'accepte plus.
const ALREADY_SHARED = "Votre position a déjà été reçue pour cette livraison.";

const landmark = z.string().trim().max(200).optional();
const shareInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  landmark,
  consent: z.literal(true, { errorMap: () => ({ message: "Votre accord est nécessaire" }) }),
});

const pricedSelect = {
  pickupLatitude: true,
  pickupLongitude: true,
  subtotal: true,
  discount: true,
  extraFee: true,
  deliveryFee: true,
} satisfies Prisma.OrderSelect;
type PricedOrder = Prisma.OrderGetPayload<{ select: typeof pricedSelect }>;

export function positionRouter(prisma: PrismaClient, config: Config) {
  const router = Router();

  router.use("/position", (_req, res, next) => {
    res.set({ "X-Robots-Tag": "noindex", "Cache-Control": "no-store" });
    next();
  });

  // Le prix de livraison est fixé avec le point de livraison : distance depuis la position du retrait.
  // Sans position du retrait (adresse écrite seulement), le tarif minimum reste appliqué.
  function dropPoint(o: PricedOrder, p: { latitude: number; longitude: number }, source: "SENDER" | "RECIPIENT", tariff: ParcelTariff) {
    const km = parcelDistanceKm({ latitude: o.pickupLatitude, longitude: o.pickupLongitude }, p);
    const fee = parcelFee(tariff, km);
    return { latitude: p.latitude, longitude: p.longitude, locationSource: source, distanceKm: km, deliveryFee: fee, total: o.subtotal - o.discount + fee + o.extraFee };
  }

  // La zone suit le point de livraison ; hors des zones connues, elle reste celle de la commande.
  async function zoneOf(p: { latitude: number; longitude: number }) {
    const zoneId = await zoneForPoint(prisma, p);
    return zoneId ? { zoneId } : {};
  }

  // Le colis peut maintenant partir : la répartition est prévenue (alarme), le livreur aussi s'il est déjà affecté.
  function announce(o: PricedOrder & { id: string; code: string; driverId: string | null }, what: string, d: { distanceKm: number | null; deliveryFee: number; total: number }) {
    const body = `${what}${d.distanceKm !== null ? ` · ${d.distanceKm} km` : ""} · total ${formatFcfa(d.total)}`;
    void config.notifier.staff("ORDERS", { title: `Colis ${o.code} prêt à partir`, body, url: `/admin/commandes/${o.id}`, tag: `order-${o.id}`, alarm: true });
    if (o.driverId) void config.notifier.push("driver", o.driverId, { title: `Colis ${o.code}`, body: "Le point de livraison est à jour.", url: `/livreur/course/${o.id}`, tag: `position-${o.id}` });
  }

  async function findRequest(token: string) {
    if (!isTokenShape(token)) return null;
    const request = await prisma.locationRequest.findUnique({
      where: { tokenHash: hashLocationToken(token) },
      include: {
        order: {
          select: {
            id: true,
            code: true,
            status: true,
            customerName: true,
            address: true,
            driverId: true,
            ...pricedSelect,
          },
        },
        restaurant: { select: { id: true, name: true, address: true } },
      },
    });
    return request && linkUsable(request, request.order?.status ?? null, new Date()) ? request : null;
  }

  // Page du destinataire : seulement le prénom de l'expéditeur et l'état du lien.
  router.get("/position/:token", async (req, res) => {
    const request = await findRequest(req.params.token);
    if (!request) {
      res.status(404).json({ error: GONE });
      return;
    }
    if (request.status === "PENDING") await prisma.locationRequest.update({ where: { id: request.id }, data: { status: "OPENED", openedAt: new Date() } });
    const status = request.status === "PENDING" ? "OPENED" : request.status;
    // Gérant d'un restaurant : la demande vient de Zedeka, la page montre le nom du restaurant.
    if (request.restaurant) {
      res.json({ kind: "RESTAURANT", restaurantName: request.restaurant.name, status, expiresAt: request.expiresAt });
      return;
    }
    res.json({ senderFirstName: firstName(request.order?.customerName ?? request.senderName ?? ""), kind: request.kind, status: request.status === "PENDING" ? "OPENED" : request.status, expiresAt: request.expiresAt });
  });

  router.post("/position/:token", async (req, res) => {
    const parsed = shareInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const request = await findRequest(req.params.token);
    if (!request) {
      res.status(404).json({ error: GONE });
      return;
    }
    if (request.status === "SHARED") {
      res.status(409).json({ error: ALREADY_SHARED });
      return;
    }
    const input = parsed.data;
    const now = new Date();
    const answer = { status: "SHARED", consentAt: now, respondedAt: now, latitude: input.latitude, longitude: input.longitude, accuracyM: input.accuracy ?? null, landmark: input.landmark || null };
    const r = request.restaurant;
    if (r) {
      // Position du restaurant : elle sert de point de retrait et au prix au km de ses livraisons.
      await prisma.$transaction([
        prisma.restaurant.update({ where: { id: r.id }, data: { latitude: input.latitude, longitude: input.longitude, address: addressWithLandmark(r.address, input.landmark) } }),
        prisma.locationRequest.update({ where: { id: request.id }, data: answer }),
      ]);
      void config.notifier.staff("RESTAURANTS", {
        title: `Position reçue : ${r.name}`,
        body: "Le restaurant est placé sur la carte. Vous pouvez le rendre visible pour les clients.",
        url: `/admin/restaurants/${r.id}`,
        tag: `restaurant-position-${r.id}`,
      });
      res.json({ ok: true });
      return;
    }
    const o = request.order;
    if (!o) {
      // Commande pas encore passée : l'expéditeur voit la réponse arriver dans son formulaire.
      await prisma.locationRequest.update({ where: { id: request.id }, data: answer });
      res.json({ ok: true });
      return;
    }
    const d = { ...dropPoint(o, input, "RECIPIENT", await getSettings(prisma)), ...(await zoneOf(input)) };
    await prisma.$transaction([
      prisma.order.update({ where: { id: o.id }, data: { ...d, address: addressWithLandmark(o.address, input.landmark) } }),
      prisma.locationRequest.update({ where: { id: request.id }, data: answer }),
    ]);
    announce(o, input.accuracy ? `Position du destinataire reçue, à ${Math.round(input.accuracy)} m près` : "Position du destinataire reçue", d);
    res.json({ ok: true });
  });

  router.post("/position/:token/decline", async (req, res) => {
    const parsed = z.object({ landmark }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const request = await findRequest(req.params.token);
    if (!request) {
      res.status(404).json({ error: GONE });
      return;
    }
    if (request.status === "SHARED") {
      res.status(409).json({ error: ALREADY_SHARED });
      return;
    }
    // Un restaurant ne peut pas recevoir de commandes sans position : pas de refus possible.
    if (request.restaurant) {
      res.status(400).json({ error: "La position du restaurant est nécessaire pour recevoir des commandes." });
      return;
    }
    const lm = parsed.data.landmark || undefined;
    const o = request.order;
    await prisma.$transaction([
      ...(o ? [prisma.order.update({ where: { id: o.id }, data: { address: addressWithLandmark(o.address, lm) } })] : []),
      prisma.locationRequest.update({
        where: { id: request.id },
        data: { status: "DECLINED", respondedAt: new Date(), ...(lm ? { landmark: lm } : {}) },
      }),
    ]);
    res.json({ ok: true });
  });

  // Demande de position avant la commande : lien à copier pour le destinataire, clé de suivi pour l'expéditeur.
  router.post("/location-requests", async (req, res) => {
    const parsed = z
      .object({ senderName: z.string().trim().min(2).max(80), recipientName: z.string().trim().max(80).optional(), kind: z.enum(["FOOD", "PARCEL"]).default("PARCEL") })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Indiquez votre nom avant de demander la position" });
      return;
    }
    // FOOD : repas livré à quelqu'un d'autre, qui donne lui-même sa position avant la commande.
    const who = { senderName: parsed.data.senderName, recipientName: parsed.data.recipientName || null, kind: parsed.data.kind };
    const { token, pollKey, expiresAt } = await issueStandaloneLink(prisma, who, new Date());
    const link = locationLink(config.frontendOrigin, token, { customerName: who.senderName, recipientName: who.recipientName, kind: who.kind }, expiresAt);
    res.status(201).json({ url: link.url, text: link.text, expiresAt: link.expiresAt, pollKey });
  });

  // Réponse du destinataire, lue par l'expéditeur pendant le compte à rebours (seul lui a la clé).
  router.get("/location-requests/:key", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const key = req.params.key;
    const request = isTokenShape(key) ? await prisma.locationRequest.findUnique({ where: { pollKeyHash: hashLocationToken(key) } }) : null;
    if (!request || request.orderId || request.expiresAt <= new Date()) {
      res.status(404).json({ error: "Demande introuvable ou expirée" });
      return;
    }
    const shared = request.status === "SHARED";
    res.json({
      status: request.status,
      expiresAt: request.expiresAt,
      ...(shared ? { latitude: request.latitude, longitude: request.longitude, accuracy: request.accuracyM, landmark: request.landmark } : {}),
    });
  });

  // Recherche de lieu sur la carte : nom (quartier, rue, marché…) ou lien Google Maps collé.
  router.get("/places", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 300) : "";
    if (q.length < 3) {
      res.json([]);
      return;
    }
    try {
      res.json(await searchPlaces(q));
    } catch {
      res.status(503).json({ error: "Recherche indisponible pour le moment. Déplacez la carte, ou collez un lien Google Maps." });
    }
  });

  // Lien Google Maps (ou coordonnées) collé pour placer un point sur la carte.
  router.post("/maps-link", async (req, res) => {
    const parsed = z.object({ url: z.string().trim().min(3).max(2000) }).safeParse(req.body);
    const point = parsed.success ? await resolveMapsLink(parsed.data.url).catch(() => null) : null;
    if (!point) {
      res.status(422).json({ error: "Position introuvable dans ce lien. Dans Google Maps, touchez le point puis « Partager » et copiez le lien." });
      return;
    }
    res.json(point);
  });

  // Colis de l'expéditeur, pour agir depuis le suivi : le compte qui a passé la commande, ou le code et son numéro.
  async function senderParcel(req: Request) {
    const parsed = z.object({ phone: z.string().trim().max(20).optional() }).passthrough().safeParse(req.body ?? {});
    const order = await prisma.order.findUnique({
      where: { code: normalizeCode(String(req.params.code)) },
      select: { id: true, code: true, type: true, status: true, driverId: true, customerId: true, customerName: true, customerPhone: true, recipientName: true, recipientPhone: true, ...pricedSelect },
    });
    const tail = (p: string) => p.replace(/\D/g, "").slice(-8);
    const phone = parsed.success ? (parsed.data.phone ?? "") : "";
    const customerId = await linkedCustomerId(prisma, req, config.secret);
    const allowed = order && ((customerId && order.customerId === customerId) || (tail(phone).length === 8 && tail(phone) === tail(order.customerPhone)));
    return order && allowed && order.type === "PARCEL" ? order : null;
  }
  const NOT_FOUND = "Aucun colis ne correspond à ce code et ce numéro";

  // Nouveau lien depuis le suivi (l'ancien cesse de marcher), tant que le prix n'est pas fixé.
  router.post("/parcels/:code/location-link", async (req, res) => {
    const order = await senderParcel(req);
    if (!order) {
      res.status(404).json({ error: NOT_FOUND });
      return;
    }
    if (order.status !== "PENDING") {
      res.status(409).json({ error: "Le colis est déjà confié à un livreur : la position ne peut plus être demandée." });
      return;
    }
    const { token, expiresAt } = await issueLocationLink(prisma, order.id, new Date());
    res.status(201).json(locationLink(config.frontendOrigin, token, order, expiresAt));
  });

  // L'expéditeur place lui-même le point de livraison (sans réponse ou après un refus du destinataire).
  router.post("/parcels/:code/delivery-point", async (req, res) => {
    const point = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).safeParse(req.body);
    if (!point.success) {
      res.status(400).json({ error: "Placez le point de livraison" });
      return;
    }
    const order = await senderParcel(req);
    if (!order) {
      res.status(404).json({ error: NOT_FOUND });
      return;
    }
    if (order.status !== "PENDING") {
      res.status(409).json({ error: "Le colis est déjà confié à un livreur : contactez Zedeka pour changer le point de livraison." });
      return;
    }
    const d = { ...dropPoint(order, point.data, "SENDER", await getSettings(prisma)), ...(await zoneOf(point.data)) };
    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: d }),
      // Le lien du destinataire cesse de marcher : le point est fixé.
      prisma.locationRequest.updateMany({ where: { orderId: order.id }, data: { status: "REVOKED" } }),
    ]);
    announce(order, "Point de livraison placé par l'expéditeur", d);
    res.json({ deliveryFee: d.deliveryFee, total: d.total, distanceKm: d.distanceKm });
  });

  return router;
}
