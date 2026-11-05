import { type Response, Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireCustomer, revokedLongToken } from "../auth.js";
import { normalizePhone } from "../customer.js";
import { ADDRESS_FROM_RECIPIENT, firstName, issueLocationLink, locationStatus } from "../locationRequest.js";
import type { Notifier } from "../notify.js";
import { merchantNet, orderTotal, priceParcel } from "../parcel.js";
import { formatFcfa, normalizeCode } from "../pricing.js";
import { createOrderWithCode, firstError, getSettings, phone } from "../util.js";
import { acceptTerms } from "./public.js";

// Appli marchand (/marchand) : boutiques en ligne qui envoient surtout des colis. Le marchand se connecte avec
// son compte client (numéro ou e-mail et PIN) et y ajoute un profil boutique : point de ramassage, ramassage
// habituel, numéro pour les reversements. Ses colis sont des commandes PARCEL ordinaires (même prix, même
// répartition, même appli livreur) avec en plus le contre-remboursement : le livreur encaisse le prix des
// articles chez le destinataire, et Zedeka le reverse au marchand, moins la livraison s'il la paie.

type Config = { secret: string; notifier: Notifier; frontendOrigin: string };

export const MAX_BATCH = 50;
const PICKUP_REQUEST_EVERY_MS = 10 * 60_000;
const OPEN_STATUSES = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP"] as const;

const point = { latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() };
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide (HH:MM)");

const profileInput = z
  .object({
    shopName: z.string().trim().min(2).max(80),
    phone,
    pickupAddress: z.string().trim().min(3).max(300),
    pickupLatitude: point.latitude,
    pickupLongitude: point.longitude,
    // Ramassage habituel : jours (0 = dimanche) et heure, facultatifs.
    pickupDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    pickupTime: z.union([time, z.literal("").transform(() => null), z.null()]).optional(),
    payoutPhone: z.union([phone, z.literal("").transform(() => null), z.null()]).optional(),
  })
  .refine((p) => (p.pickupLatitude === undefined) === (p.pickupLongitude === undefined), { message: "Position du ramassage incomplète" });

// Un colis de l'envoi. Le point de livraison est une position, ou le destinataire la partage par un lien ; une
// adresse écrite seule reste acceptée (prix minimum, confirmé par Zedeka).
export const merchantParcelInput = z
  .object({
    recipientName: z.string().trim().min(2).max(80),
    recipientPhone: phone,
    address: z.string().trim().max(300).default(""),
    ...point,
    askRecipientLocation: z.boolean().default(false),
    // Prix des articles à encaisser chez le destinataire (0 : déjà payé en ligne).
    codAmount: z.number().int().min(0).max(5_000_000).default(0),
    // Qui paie la livraison : le marchand (retenue sur son reversement) ou le destinataire, en plus des articles.
    payer: z.enum(["SENDER", "RECIPIENT"]).default("SENDER"),
    merchantRef: z.string().trim().max(40).optional(),
    parcelCategoryId: z.string().min(1),
    weightKg: z.number().min(0).max(100),
    parcelSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((p) => (p.latitude === undefined) === (p.longitude === undefined), { message: "Position du destinataire incomplète" })
  .refine((p) => p.address.length >= 3 || p.latitude !== undefined || p.askRecipientLocation, { message: "Indiquez l'adresse ou la position du destinataire" });

export const batchInput = z.object({
  parcels: z.array(merchantParcelInput).min(1, "Ajoutez au moins un colis").max(MAX_BATCH, `${MAX_BATCH} colis au plus par envoi`),
});

const merchantSelect = {
  id: true,
  shopName: true,
  phone: true,
  pickupAddress: true,
  pickupLatitude: true,
  pickupLongitude: true,
  pickupDays: true,
  pickupTime: true,
  payoutPhone: true,
  active: true,
  pickupRequestedAt: true,
  createdAt: true,
} satisfies Prisma.MerchantSelect;
type MerchantRow = Prisma.MerchantGetPayload<{ select: typeof merchantSelect }>;

const parcelSelect = {
  id: true,
  code: true,
  status: true,
  recipientName: true,
  recipientPhone: true,
  address: true,
  latitude: true,
  longitude: true,
  codAmount: true,
  merchantRef: true,
  payer: true,
  deliveryFee: true,
  extraFee: true,
  discount: true,
  total: true,
  cashCollected: true,
  weightKg: true,
  parcelSize: true,
  note: true,
  merchantPayoutId: true,
  createdAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancellationReason: true,
  parcelCategory: { select: { name: true } },
  driver: { select: { name: true, phone: true } },
  zone: { select: { name: true } },
} satisfies Prisma.OrderSelect;
type ParcelRow = Prisma.OrderGetPayload<{ select: typeof parcelSelect }>;

export const daysOf = (s: string) => s.split(",").filter(Boolean).map(Number).filter((d) => d >= 0 && d <= 6);

const merchantView = (m: MerchantRow) => ({ ...m, pickupDays: daysOf(m.pickupDays) });

const parcelView = (o: ParcelRow) => ({
  ...o,
  category: o.parcelCategory?.name ?? null,
  parcelCategory: undefined,
  driver: o.driver && { name: o.driver.name, phone: o.driver.phone },
  fees: o.deliveryFee + o.extraFee - o.discount,
  // Ce qui revient au marchand une fois livré (contre-remboursement moins la livraison s'il la paie).
  net: o.status === "DELIVERED" ? merchantNet(o) : o.status === "CANCELLED" ? 0 : merchantNet({ ...o, cashCollected: null }),
  paidOut: !!o.merchantPayoutId,
});

// Message prêt à envoyer au destinataire sur WhatsApp : lien de position (24 h) au nom de la boutique.
export function recipientMessage(origin: string, shopName: string, o: { recipientName: string | null; recipientPhone: string | null; code: string }, positionUrl: string | null) {
  const hello = o.recipientName ? `Bonjour ${firstName(o.recipientName)}, ` : "Bonjour, ";
  const track = `${origin.replace(/\/$/, "")}/commande/${o.code}`;
  const text = positionUrl
    ? `${hello}votre commande ${shopName} arrive avec Zedeka. Pour que le livreur vous trouve facilement, partagez votre position ici (lien valable 24 h) : ${positionUrl}`
    : `${hello}votre commande ${shopName} arrive avec Zedeka. Suivez-la ici : ${track}`;
  const to = o.recipientPhone ? normalizePhone(o.recipientPhone) : null;
  return { text, whatsappUrl: `https://wa.me/${to ? to.slice(1) : ""}?text=${encodeURIComponent(text)}`, trackUrl: track };
}

// Solde à reverser : colis livrés et pas encore reversés.
export function balanceOf(orders: { cashCollected: number | null; total: number; deliveryFee: number; extraFee: number; discount: number }[]) {
  return orders.reduce((s, o) => s + merchantNet(o), 0);
}

export function merchantAppRouter(prisma: PrismaClient, config: Config) {
  const router = Router();
  const auth = requireCustomer(config.secret);

  // Compte client encore valide (pas supprimé, pas déconnecté partout), et son profil marchand s'il existe.
  router.use(auth, async (req, res, next) => {
    const customer = await prisma.customer.findUnique({
      where: { id: res.locals.customerId as string },
      select: { id: true, name: true, phone: true, email: true, deletedAt: true, sessionsValidFrom: true, merchant: { select: merchantSelect } },
    });
    if (!customer || customer.deletedAt || revokedLongToken(req, config.secret, customer.sessionsValidFrom)) {
      res.status(401).json({ error: "Connexion requise" });
      return;
    }
    res.locals.customer = customer;
    res.locals.merchant = customer.merchant;
    next();
  });

  const merchantOf = (res: Response) => res.locals.merchant as MerchantRow | null;
  // Les écrans de la boutique demandent un profil ; un profil suspendu ne peut plus envoyer.
  function shop(res: Response, { sending = false } = {}): MerchantRow | null {
    const m = merchantOf(res);
    if (!m) {
      res.status(404).json({ error: "Créez d'abord votre boutique" });
      return null;
    }
    if (sending && !m.active) {
      res.status(403).json({ error: "Votre boutique est suspendue : contactez Zedeka" });
      return null;
    }
    return m;
  }

  router.get("/me", (_req, res) => {
    const c = res.locals.customer as { name: string | null; phone: string; email: string | null };
    const m = merchantOf(res);
    res.json({ account: { name: c.name, phone: c.phone, email: c.email }, merchant: m && merchantView(m) });
  });

  router.post("/me", async (req, res) => {
    const parsed = profileInput.and(z.object({ acceptTerms })).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    if (merchantOf(res)) {
      res.status(409).json({ error: "Votre boutique existe déjà" });
      return;
    }
    const { acceptTerms: _a, pickupDays, ...data } = parsed.data;
    const created = await prisma.merchant.create({
      data: { ...data, pickupDays: pickupDays.join(","), pickupTime: data.pickupTime ?? null, payoutPhone: data.payoutPhone ?? null, customerId: res.locals.customerId as string },
      select: merchantSelect,
    });
    void config.notifier.staff("APPLICATIONS", { title: "Nouvelle boutique e-commerce", body: `${created.shopName} · ${created.phone}`, url: "/admin/marchands", tag: `merchant-${created.id}` });
    res.status(201).json(merchantView(created));
  });

  router.patch("/me", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const parsed = profileInput.innerType().partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { pickupDays, ...data } = parsed.data;
    const updated = await prisma.merchant.update({
      where: { id: m.id },
      data: { ...data, ...(pickupDays ? { pickupDays: pickupDays.join(",") } : {}) },
      select: merchantSelect,
    });
    res.json(merchantView(updated));
  });

  // Tableau de bord : envois du jour, en cours, à reverser, derniers reversements.
  router.get("/dashboard", async (_req, res) => {
    const m = shop(res);
    if (!m) return;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0); // Lomé est à UTC+0
    const monthStart = new Date(Date.UTC(startOfDay.getUTCFullYear(), startOfDay.getUTCMonth(), 1));
    const [today, open, waitingPickup, unpaid, month, payouts] = await Promise.all([
      prisma.order.count({ where: { merchantId: m.id, createdAt: { gte: startOfDay } } }),
      prisma.order.count({ where: { merchantId: m.id, status: { in: [...OPEN_STATUSES] } } }),
      prisma.order.count({ where: { merchantId: m.id, status: "PENDING" } }),
      prisma.order.findMany({ where: { merchantId: m.id, status: "DELIVERED", merchantPayoutId: null }, select: { cashCollected: true, total: true, deliveryFee: true, extraFee: true, discount: true, codAmount: true } }),
      prisma.order.findMany({ where: { merchantId: m.id, createdAt: { gte: monthStart } }, select: { status: true, codAmount: true } }),
      prisma.merchantPayout.findMany({ where: { merchantId: m.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, amount: true, orderCount: true, note: true, createdAt: true } }),
    ]);
    const delivered = month.filter((o) => o.status === "DELIVERED");
    res.json({
      today,
      open,
      waitingPickup,
      balance: balanceOf(unpaid),
      balanceCount: unpaid.length,
      month: {
        sent: month.length,
        delivered: delivered.length,
        cancelled: month.filter((o) => o.status === "CANCELLED").length,
        cod: delivered.reduce((s, o) => s + o.codAmount, 0),
      },
      payouts,
    });
  });

  // Liste des colis : en cours, terminés ou tous, avec recherche sur le destinataire, le code ou la référence.
  router.get("/parcels", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const filter = String(req.query.filter ?? "open");
    const q = String(req.query.q ?? "").trim().slice(0, 40);
    const where: Prisma.OrderWhereInput = {
      merchantId: m.id,
      ...(filter === "open" ? { status: { in: [...OPEN_STATUSES] } } : filter === "done" ? { status: { in: ["DELIVERED", "CANCELLED"] } } : {}),
      ...(q
        ? { OR: [{ code: { contains: q.toUpperCase() } }, { recipientName: { contains: q } }, { recipientPhone: { contains: q.replace(/\s/g, "") } }, { merchantRef: { contains: q } }] }
        : {}),
    };
    const rows = await prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, select: parcelSelect });
    res.json(rows.map(parcelView));
  });

  router.get("/parcels/:code", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const o = await prisma.order.findFirst({
      where: { code: normalizeCode(req.params.code), merchantId: m.id },
      select: { ...parcelSelect, deliveryCode: true, handedOverAt: true, receiptDisputedAt: true, locationRequest: { select: { status: true, expiresAt: true } } },
    });
    if (!o) {
      res.status(404).json({ error: "Colis introuvable" });
      return;
    }
    const { locationRequest, deliveryCode, ...rest } = o;
    const position = locationStatus(locationRequest, o.status, new Date());
    res.json({
      ...parcelView(rest),
      handedOverAt: o.handedOverAt,
      disputed: !!o.receiptDisputedAt,
      // Code à donner au livreur si le destinataire ne l'a pas : seulement pendant la livraison.
      deliveryCode: o.status === "PICKED_UP" ? deliveryCode : null,
      locationStatus: position,
      message: recipientMessage(config.frontendOrigin, m.shopName, o, null),
    });
  });

  // Devis d'un envoi, ligne par ligne, avant de le valider (même calcul que la création).
  router.post("/parcels/quote", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const priced = await priceBatch(req.body, m, res);
    if (!priced) return;
    res.json({
      lines: priced.map((p) => ({ fee: p.price.fee + p.price.extraFee, km: p.price.km, zone: p.price.zoneName || null, toConfirm: p.toConfirm, waiting: p.waiting, toCollect: p.total })),
      fees: priced.reduce((s, p) => s + p.price.fee + p.price.extraFee, 0),
      cod: priced.reduce((s, p) => s + p.input.codAmount, 0),
    });
  });

  // Envoi d'un ou plusieurs colis depuis le point de ramassage de la boutique.
  router.post("/parcels", async (req, res) => {
    const m = shop(res, { sending: true });
    if (!m) return;
    const priced = await priceBatch(req.body, m, res);
    if (!priced) return;
    const now = new Date();
    const created = [];
    for (const { input, price, waiting, total } of priced) {
      const order = await createOrderWithCode(prisma, {
        type: "PARCEL",
        merchantId: m.id,
        customerId: res.locals.customerId as string,
        customerName: m.shopName,
        customerPhone: m.phone,
        termsAcceptedAt: now,
        zoneId: price.zoneId,
        distanceKm: price.km,
        pickupAddress: m.pickupAddress,
        pickupLatitude: m.pickupLatitude,
        pickupLongitude: m.pickupLongitude,
        address: input.address || ADDRESS_FROM_RECIPIENT,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        locationSource: input.latitude !== undefined ? "SENDER" : null,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        parcelCategoryId: input.parcelCategoryId,
        weightKg: input.weightKg,
        parcelSize: input.parcelSize ?? null,
        note: input.note || null,
        merchantRef: input.merchantRef || null,
        codAmount: input.codAmount,
        // Toujours en espèces : le livreur encaisse le total (articles, plus la livraison si le destinataire la paie).
        paymentMethod: "CASH",
        payer: input.payer,
        subtotal: input.codAmount,
        deliveryFee: price.fee,
        extraFee: price.extraFee,
        total,
      });
      const link = waiting ? await issueLocationLink(prisma, order.id, now) : null;
      const positionUrl = link ? `${config.frontendOrigin.replace(/\/$/, "")}/position/${link.token}` : null;
      created.push({ code: order.code, recipientName: order.recipientName, total: order.total, fees: price.fee + price.extraFee, awaitingPosition: waiting, message: recipientMessage(config.frontendOrigin, m.shopName, order, positionUrl) });
    }
    const fees = priced.reduce((s, p) => s + p.price.fee + p.price.extraFee, 0);
    void config.notifier.staff("ORDERS", {
      title: created.length > 1 ? `${created.length} colis de ${m.shopName}` : `Colis ${created[0].code} · ${m.shopName}`,
      body: `Ramassage : ${m.pickupAddress} · livraison ${formatFcfa(fees)}`,
      url: created.length > 1 ? `/admin/commandes?q=${encodeURIComponent(m.shopName)}` : `/admin/commandes`,
      tag: `merchant-batch-${m.id}-${now.getTime()}`,
      alarm: created.some((c) => !c.awaitingPosition),
    });
    res.status(201).json({ parcels: created, fees });
  });

  // Annulation tant qu'aucun livreur n'a le colis.
  router.post("/parcels/:code/cancel", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const o = await prisma.order.findFirst({ where: { code: normalizeCode(req.params.code), merchantId: m.id }, select: { id: true, status: true, driverId: true } });
    if (!o) {
      res.status(404).json({ error: "Colis introuvable" });
      return;
    }
    const { count } = await prisma.order.updateMany({
      where: { id: o.id, status: "PENDING", driverId: null },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Annulé par le marchand" },
    });
    if (!count) {
      res.status(409).json({ error: "Un livreur a déjà ce colis : contactez Zedeka pour l'annuler" });
      return;
    }
    res.json({ ok: true });
  });

  // « Venez ramasser » : prévient l'équipe que des colis attendent au point de ramassage.
  router.post("/pickup-request", async (_req, res) => {
    const m = shop(res, { sending: true });
    if (!m) return;
    const waiting = await prisma.order.count({ where: { merchantId: m.id, status: "PENDING" } });
    if (!waiting) {
      res.status(400).json({ error: "Aucun colis n'attend le ramassage" });
      return;
    }
    const now = new Date();
    if (m.pickupRequestedAt && now.getTime() - m.pickupRequestedAt.getTime() < PICKUP_REQUEST_EVERY_MS) {
      res.status(429).json({ error: "Demande déjà envoyée : l'équipe arrive" });
      return;
    }
    await prisma.merchant.update({ where: { id: m.id }, data: { pickupRequestedAt: now } });
    void config.notifier.staff("ORDERS", {
      title: `Ramassage demandé : ${m.shopName}`,
      body: `${waiting} colis à ramasser · ${m.pickupAddress} · ${m.phone}`,
      url: `/admin/commandes?q=${encodeURIComponent(m.shopName)}`,
      tag: `merchant-pickup-${m.id}`,
      alarm: true,
    });
    res.json({ ok: true, waiting, requestedAt: now });
  });

  router.get("/payouts", async (_req, res) => {
    const m = shop(res);
    if (!m) return;
    res.json(await prisma.merchantPayout.findMany({ where: { merchantId: m.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, amount: true, orderCount: true, note: true, createdAt: true } }));
  });

  // Prix de chaque colis de l'envoi ; renvoie null (et répond 400) si l'envoi est invalide.
  async function priceBatch(body: unknown, m: MerchantRow, res: Response) {
    const parsed = batchInput.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const line = issue?.path[0] === "parcels" && typeof issue.path[1] === "number" ? `Colis ${issue.path[1] + 1} : ` : "";
      res.status(400).json({ error: `${line}${firstError(parsed.error)}` });
      return null;
    }
    const ids = [...new Set(parsed.data.parcels.map((p) => p.parcelCategoryId))];
    const [categories, settings] = await Promise.all([prisma.parcelCategory.findMany({ where: { id: { in: ids }, active: true } }), getSettings(prisma)]);
    const out = [];
    for (const input of parsed.data.parcels) {
      const category = categories.find((c) => c.id === input.parcelCategoryId);
      if (!category) {
        res.status(400).json({ error: "Catégorie de colis inconnue" });
        return null;
      }
      const drop = input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : null;
      const price = await priceParcel(prisma, settings, { latitude: m.pickupLatitude, longitude: m.pickupLongitude }, drop, category, input.weightKg);
      const waiting = !drop && input.askRecipientLocation;
      const total = orderTotal({ subtotal: input.codAmount, discount: 0, deliveryFee: price.fee, extraFee: price.extraFee, merchantId: m.id, payer: input.payer });
      out.push({ input, price, waiting, toConfirm: price.km === null && !waiting && !price.byZone, total });
    }
    return out;
  }

  return router;
}
