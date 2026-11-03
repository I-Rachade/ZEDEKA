import { type Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { normalizePhone } from "../customer.js";
import type { Notifier } from "../notify.js";
import { requestOtp, verifyOtp, type PhoneVerifier } from "../otp.js";
import { hashPin, newPinInput } from "../pin.js";
import type { FileStore } from "../storage.js";
import { firstError, getSettings } from "../util.js";
import { distanceKm } from "../delivery.js";
import {
  activePlan,
  advanceRide,
  DOCUMENT_KINDS,
  nextPeriod,
  offerExpiresAt,
  pendingOfferFor,
  REQUIRED_DOCUMENTS,
  RIDE_OPEN,
  RIDE_WITH_DRIVER,
  rideCode,
  type DocumentKind,
} from "../zed.js";
import { HttpError } from "./adminWrite.js";
import { driverByPhone, otpKey } from "./driverApp.js";

// Mode Zed côté conducteur (/api/livreur/zed), côté client (/api/customer/zed) et côté admin (/api/admin/zed).

const MAX_PHOTO_BYTES = 1_500_000;

const phoneInput = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numéro togolais invalide (8 chiffres)" });
    return z.NEVER;
  }
  return phone;
});
const plateInput = z.string().trim().toUpperCase().min(3, "Indiquez la plaque de la moto").max(20);
// Photos envoyées par l'appli (data URL JPEG, PNG ou WebP, réduites sur le téléphone).
const photoInput = z.string().max(2_200_000).regex(/^data:image\/(jpeg|png|webp);base64,/, "Photo illisible");
const photosInput = z.object({ SELFIE: photoInput, ID_CARD: photoInput, LICENCE: photoInput, MOTO: photoInput.optional() });

function decodePhoto(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const [head, b64] = dataUrl.split(",", 2);
  const contentType = head.slice(5, head.indexOf(";"));
  const bin = atob(b64 ?? "");
  if (bin.length > MAX_PHOTO_BYTES) throw new HttpError(413, "Photo trop lourde (1,5 Mo au plus)");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

async function storeDocuments(prisma: PrismaClient, files: FileStore | undefined, driverId: string, photos: z.infer<typeof photosInput>) {
  if (!files) throw new HttpError(503, "L'envoi des photos n'est pas disponible pour le moment");
  for (const kind of DOCUMENT_KINDS) {
    const photo = photos[kind];
    if (!photo) continue;
    const { bytes, contentType } = decodePhoto(photo);
    const fileKey = `zed/${driverId}/${kind.toLowerCase()}-${Date.now()}`;
    await files.put(fileKey, bytes, contentType);
    const old = await prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId, kind } } });
    if (old) {
      await prisma.zedDocument.update({ where: { id: old.id }, data: { fileKey, createdAt: new Date() } });
      await files.delete(old.fileKey).catch(() => {});
    } else {
      await prisma.zedDocument.create({ data: { driverId, kind, fileKey } });
    }
  }
}

function sendError(res: Response, e: unknown) {
  if (e instanceof HttpError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  throw e;
}

const fmtDistance = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);

// --- Conducteur : inscription (sans compte) ---

type DriverConfig = { secret: string; devCodes: boolean; verifier?: PhoneVerifier; notifier: Notifier; files?: FileStore };

export function zedSignupRoutes(router: Router, prisma: PrismaClient, config: DriverConfig) {
  // Code SMS pour un numéro qui n'a pas encore de compte.
  router.post("/zed/signup/otp", async (req, res) => {
    const parsed = z.object({ phone: phoneInput }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone } = parsed.data;
    if (await driverByPhone(prisma, phone)) {
      res.status(409).json({ error: "Ce numéro a déjà un compte. Connectez-vous, puis inscrivez-vous au mode Zed depuis votre profil.", login: true });
      return;
    }
    const result = await requestOtp(prisma, config, otpKey(phone), phone, "L'envoi des codes n'est pas encore disponible. Appelez Zedeka.");
    res.status(result.ok ? 200 : result.status).json(result.body);
  });

  // Inscription d'un conducteur Zed : numéro vérifié, PIN, plaque et photos. Le compte attend la vérification des pièces.
  router.post("/zed/signup", async (req, res) => {
    const parsed = z
      .object({
        phone: phoneInput,
        code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres"),
        name: z.string().trim().min(3, "Indiquez votre nom et prénom").max(80),
        plate: plateInput,
        pin: newPinInput,
        acceptTerms: z.literal(true, { errorMap: () => ({ message: "Acceptez les conditions des conducteurs Zed" }) }),
        photos: photosInput,
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone, code, name, plate, pin, photos } = parsed.data;
    try {
      if (await driverByPhone(prisma, phone)) throw new HttpError(409, "Ce numéro a déjà un compte. Connectez-vous.");
      const checked = await verifyOtp(prisma, config, otpKey(phone), phone, code);
      if (!checked.ok) {
        res.status(checked.status).json(checked.body);
        return;
      }
      const now = new Date();
      const driver = await prisma.driver.create({
        data: {
          name,
          phone,
          plate,
          status: "PENDING",
          active: false,
          vehicle: "MOTO",
          deliveries: false,
          zedStatus: "PENDING",
          zedAppliedAt: now,
          pinHash: await hashPin(pin),
          termsAcceptedAt: now,
        },
      });
      await storeDocuments(prisma, config.files, driver.id, photos);
      await config.notifier.staff("DRIVERS", { title: "Nouveau conducteur Zed", body: `${name} (${plate}) attend la vérification de ses pièces.`, url: `/admin/zed/${driver.id}`, tag: `zed-signup-${driver.id}` });
      res.status(201).json({ application: { name, status: "PENDING", createdAt: driver.createdAt, zed: true } });
    } catch (e) {
      sendError(res, e);
    }
  });
}

// --- Conducteur connecté ---

const rideForDriver = {
  id: true,
  code: true,
  status: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  landmark: true,
  price: true,
  createdAt: true,
  acceptedAt: true,
  onboardAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  customer: { select: { name: true, phone: true } },
} as const;

// Ce que l'application conducteur montre du mode Zed (accueil, profil, plan).
export async function zedState(prisma: PrismaClient, driverId: string, now = new Date()) {
  const [driver, payments, s] = await Promise.all([
    prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { zedStatus: true, zedAvailable: true, plate: true, deliveries: true, employment: true, zedNote: true } }),
    prisma.zedPayment.findMany({ where: { driverId }, orderBy: { createdAt: "desc" }, take: 20 }),
    getSettings(prisma),
  ]);
  const plan = activePlan(payments, now);
  return {
    status: driver.zedStatus,
    available: driver.zedAvailable,
    plate: driver.plate,
    deliveries: driver.deliveries,
    note: driver.zedStatus === "REJECTED" ? driver.zedNote : null,
    canApply: !driver.zedStatus && driver.employment === "FREELANCE",
    plan: plan ? { endsAt: plan.endsAt.toISOString() } : null,
    payments: payments.map((p) => ({ id: p.id, plan: p.plan, days: p.days, amount: p.amount, method: p.method, reference: p.reference, status: p.status, startsAt: p.startsAt, endsAt: p.endsAt, note: p.note, createdAt: p.createdAt })),
    prices: { month: s.zedMonthPrice, day: s.zedDayPrice, trialDays: s.zedTrialDays, paymentNumber: s.zedPaymentNumber },
    enabled: s.zedEnabled,
  };
}

// Alerte en attente et course en cours, ajoutées à /current.
export async function zedCurrent(prisma: PrismaClient, notifier: Notifier, driverId: string, now = new Date()) {
  const [offer, ride] = await Promise.all([
    pendingOfferFor(prisma, notifier, driverId, now),
    prisma.zedRide.findFirst({ where: { driverId, status: { in: [...RIDE_WITH_DRIVER] } }, orderBy: { createdAt: "desc" }, select: rideForDriver }),
  ]);
  return { offer, ride };
}

export function zedDriverRoutes(router: Router, prisma: PrismaClient, config: DriverConfig) {
  const { notifier } = config;

  router.get("/zed", async (_req, res) => {
    res.json(await zedState(prisma, res.locals.driverId));
  });

  // Livreur indépendant déjà inscrit qui veut faire du Zed : plaque et photos, puis vérification par l'équipe.
  router.post("/zed/apply", async (req, res) => {
    const parsed = z.object({ plate: plateInput, photos: photosInput, acceptTerms: z.literal(true, { errorMap: () => ({ message: "Acceptez les conditions des conducteurs Zed" }) }) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const driverId: string = res.locals.driverId;
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { name: true, employment: true, zedStatus: true } });
      if (driver.employment !== "FREELANCE") throw new HttpError(403, "Le mode Zed est réservé aux livreurs indépendants");
      if (driver.zedStatus && driver.zedStatus !== "REJECTED") throw new HttpError(409, "Vous êtes déjà inscrit au mode Zed");
      await storeDocuments(prisma, config.files, driverId, parsed.data.photos);
      await prisma.driver.update({ where: { id: driverId }, data: { plate: parsed.data.plate, zedStatus: "PENDING", zedAppliedAt: new Date(), zedNote: null } });
      await notifier.staff("DRIVERS", { title: "Nouveau conducteur Zed", body: `${driver.name} (${parsed.data.plate}) attend la vérification de ses pièces.`, url: `/admin/zed/${driverId}`, tag: `zed-signup-${driverId}` });
      res.status(201).json(await zedState(prisma, driverId));
    } catch (e) {
      sendError(res, e);
    }
  });

  router.patch("/zed/available", async (req, res) => {
    const parsed = z.object({ available: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    const state = await zedState(prisma, driverId);
    if (parsed.data.available) {
      if (state.status !== "ACTIVE") {
        res.status(403).json({ error: "Votre dossier Zed n'est pas encore validé" });
        return;
      }
      if (!state.plan) {
        res.status(402).json({ error: "Plan Zed expiré : payez votre plan pour recevoir des appels" });
        return;
      }
    }
    await prisma.driver.update({ where: { id: driverId }, data: { zedAvailable: parsed.data.available, zedMissed: 0 } });
    res.json({ available: parsed.data.available });
  });

  // Paiement du plan : mobile money vers le numéro de Zedeka, référence saisie, confirmée par l'équipe.
  router.post("/zed/payments", async (req, res) => {
    const parsed = z
      .object({
        plan: z.enum(["MONTH", "DAY"]),
        days: z.number().int().min(1).max(31).optional(),
        method: z.enum(["FLOOZ", "TMONEY"]),
        reference: z.string().trim().toUpperCase().min(4, "Indiquez la référence de la transaction").max(40),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { name: true, zedStatus: true } });
    if (!driver.zedStatus || driver.zedStatus === "REJECTED") {
      res.status(403).json({ error: "Inscrivez-vous d'abord au mode Zed" });
      return;
    }
    if (await prisma.zedPayment.findUnique({ where: { reference: parsed.data.reference } })) {
      res.status(409).json({ error: "Cette référence a déjà été envoyée" });
      return;
    }
    const s = await getSettings(prisma);
    const days = parsed.data.plan === "MONTH" ? 30 : (parsed.data.days ?? 1);
    const amount = parsed.data.plan === "MONTH" ? s.zedMonthPrice : s.zedDayPrice * days;
    await prisma.zedPayment.create({ data: { driverId, plan: parsed.data.plan, days, amount, method: parsed.data.method, reference: parsed.data.reference } });
    await notifier.staff("DRIVERS", {
      title: "Paiement plan Zed à confirmer",
      body: `${driver.name} : ${amount.toLocaleString("fr-FR")} FCFA (${parsed.data.method === "FLOOZ" ? "Flooz" : "T-Money"}, réf. ${parsed.data.reference})`,
      url: "/admin/zed?onglet=paiements",
      tag: `zed-pay-${driverId}`,
    });
    res.status(201).json(await zedState(prisma, driverId));
  });

  async function ownOffer(id: string, driverId: string) {
    const offer = await prisma.zedOffer.findUnique({ where: { id }, select: { id: true, rideId: true, driverId: true, status: true, sentAt: true } });
    if (!offer || offer.driverId !== driverId) throw new HttpError(404, "Appel introuvable");
    return offer;
  }

  router.post("/zed/offers/:id/accept", async (req, res) => {
    try {
      const driverId: string = res.locals.driverId;
      const offer = await ownOffer(String(req.params.id), driverId);
      const s = await getSettings(prisma);
      const now = new Date();
      const late = offerExpiresAt(offer.sentAt, s.zedOfferSeconds).getTime() <= now.getTime();
      if (offer.status !== "SENT" || late) {
        if (late) await advanceRide(prisma, notifier, offer.rideId, now, s);
        throw new HttpError(409, late ? "Délai dépassé : l'appel est passé au conducteur suivant" : "Cet appel ne vous est plus proposé");
      }
      const taken = await prisma.zedOffer.updateMany({ where: { id: offer.id, status: "SENT" }, data: { status: "ACCEPTED", respondedAt: now } });
      if (!taken.count) throw new HttpError(409, "Cet appel ne vous est plus proposé");
      const { count } = await prisma.zedRide.updateMany({ where: { id: offer.rideId, status: "SEARCHING" }, data: { status: "ACCEPTED", driverId, acceptedAt: now } });
      if (!count) {
        await prisma.zedOffer.update({ where: { id: offer.id }, data: { status: "CANCELLED" } });
        throw new HttpError(409, "Le client a annulé sa demande");
      }
      await prisma.driver.update({ where: { id: driverId }, data: { zedMissed: 0 } });
      const ride = await prisma.zedRide.findUniqueOrThrow({ where: { id: offer.rideId }, select: { customerId: true, code: true, driver: { select: { name: true, plate: true } } } });
      void notifier
        .push("customer", ride.customerId, { title: "Votre Zed arrive", body: `${ride.driver?.name} (${ride.driver?.plate ?? "moto"}) vient vous chercher.`, url: "/app/zed", tag: `zed-${offer.rideId}`, alarm: true })
        .catch(() => {});
      res.json({ rideId: offer.rideId });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/zed/offers/:id/decline", async (req, res) => {
    try {
      const driverId: string = res.locals.driverId;
      const offer = await ownOffer(String(req.params.id), driverId);
      const now = new Date();
      await prisma.zedOffer.updateMany({ where: { id: offer.id, status: "SENT" }, data: { status: "DECLINED", respondedAt: now } });
      await prisma.driver.update({ where: { id: driverId }, data: { zedMissed: 0 } });
      // L'appel part tout de suite au conducteur suivant.
      await advanceRide(prisma, notifier, offer.rideId, now);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  async function ownRide(id: string, driverId: string) {
    const ride = await prisma.zedRide.findUnique({ where: { id }, select: { ...rideForDriver, driverId: true, customerId: true } });
    if (!ride || ride.driverId !== driverId) throw new HttpError(404, "Course introuvable");
    return ride;
  }

  router.get("/zed/rides/:id", async (req, res) => {
    try {
      const { driverId: _d, customerId: _c, ...ride } = await ownRide(String(req.params.id), res.locals.driverId);
      res.json(ride);
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/zed/rides/:id/onboard", async (req, res) => {
    try {
      const ride = await ownRide(String(req.params.id), res.locals.driverId);
      const { count } = await prisma.zedRide.updateMany({ where: { id: ride.id, status: "ACCEPTED" }, data: { status: "ONBOARD", onboardAt: new Date() } });
      if (!count) throw new HttpError(409, "Course déjà commencée ou close");
      res.json(await prisma.zedRide.findUniqueOrThrow({ where: { id: ride.id }, select: rideForDriver }));
    } catch (e) {
      sendError(res, e);
    }
  });

  // Course terminée : le conducteur la clôture pour redevenir disponible ; le prix fait sur place est facultatif.
  router.post("/zed/rides/:id/complete", async (req, res) => {
    const parsed = z.object({ price: z.number().int().min(0).max(1_000_000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const ride = await ownRide(String(req.params.id), res.locals.driverId);
      const { count } = await prisma.zedRide.updateMany({
        where: { id: ride.id, status: { in: [...RIDE_WITH_DRIVER] } },
        data: { status: "COMPLETED", completedAt: new Date(), onboardAt: ride.onboardAt ?? new Date(), price: parsed.data.price ?? null },
      });
      if (!count) throw new HttpError(409, "Course déjà close");
      void notifier.push("customer", ride.customerId, { title: "Course Zed terminée", body: "Merci ! Notez votre conducteur.", url: "/app/zed", tag: `zed-${ride.id}` }).catch(() => {});
      res.json(await prisma.zedRide.findUniqueOrThrow({ where: { id: ride.id }, select: rideForDriver }));
    } catch (e) {
      sendError(res, e);
    }
  });

  // Le conducteur ne peut plus venir : la demande repart vers les autres conducteurs.
  router.post("/zed/rides/:id/cancel", async (req, res) => {
    const parsed = z.object({ reason: z.string().trim().min(3, "Indiquez la raison").max(200) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const ride = await ownRide(String(req.params.id), res.locals.driverId);
      const { count } = await prisma.zedRide.updateMany({
        where: { id: ride.id, status: "ACCEPTED" },
        data: { status: "SEARCHING", driverId: null, acceptedAt: null, cancelReason: `Conducteur : ${parsed.data.reason}` },
      });
      if (!count) throw new HttpError(409, "Client déjà à bord : terminez la course");
      void notifier.push("customer", ride.customerId, { title: "Votre Zed ne peut pas venir", body: "Nous cherchons un autre conducteur près de vous.", url: "/app/zed", tag: `zed-${ride.id}` }).catch(() => {});
      await advanceRide(prisma, notifier, ride.id);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });
}

// --- Client ---

const rideForCustomer = {
  id: true,
  code: true,
  status: true,
  latitude: true,
  longitude: true,
  landmark: true,
  createdAt: true,
  acceptedAt: true,
  onboardAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  rating: true,
  ratingComment: true,
  price: true,
  driver: { select: { name: true, phone: true, plate: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true } },
  _count: { select: { offers: true } },
} as const;

function customerView(r: Record<string, unknown> & { status: string; latitude: number; longitude: number; driver: { name: string; phone: string; plate: string | null; lastLatitude: number | null; lastLongitude: number | null; lastLocationAt: Date | null } | null; _count: { offers: number } }) {
  const { driver, _count, ...rest } = r;
  // Numéro et position du conducteur : seulement pendant la course.
  const live = driver && (RIDE_WITH_DRIVER as readonly string[]).includes(r.status);
  const distanceM =
    live && driver.lastLatitude !== null && driver.lastLongitude !== null ? Math.round(distanceKm(r, { latitude: driver.lastLatitude, longitude: driver.lastLongitude }) * 1000) : null;
  return {
    ...rest,
    alerted: _count.offers,
    driver: driver
      ? {
          name: driver.name,
          plate: driver.plate,
          phone: live ? driver.phone : null,
          latitude: live ? driver.lastLatitude : null,
          longitude: live ? driver.lastLongitude : null,
          distanceM,
          distance: distanceM !== null ? fmtDistance(distanceM) : null,
        }
      : null,
  };
}

export function zedCustomerRoutes(router: Router, prisma: PrismaClient, notifier: Notifier) {
  async function ownRide(id: string, customerId: string) {
    const ride = await prisma.zedRide.findUnique({ where: { id }, select: { ...rideForCustomer, customerId: true } });
    if (!ride || ride.customerId !== customerId) throw new HttpError(404, "Course introuvable");
    return ride;
  }

  // Appeler un Zed : la position du client est obligatoire, pas de destination.
  router.post("/zed", async (req, res) => {
    const parsed = z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100_000).optional(),
        landmark: z.string().trim().max(120).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Partagez votre position pour appeler un Zed" });
      return;
    }
    const customerId: string = res.locals.customerId;
    const s = await getSettings(prisma);
    if (!s.zedEnabled) {
      res.status(503).json({ error: "Le service Zed n'est pas encore ouvert" });
      return;
    }
    const now = new Date();
    const open = await prisma.zedRide.findFirst({ where: { customerId, status: { in: [...RIDE_OPEN] } }, select: { id: true } });
    if (open) {
      res.status(409).json({ error: "Vous avez déjà un Zed en cours", rideId: open.id });
      return;
    }
    const [lastMinute, today] = await Promise.all([
      prisma.zedRide.count({ where: { customerId, createdAt: { gte: new Date(now.getTime() - 60_000) } } }),
      prisma.zedRide.count({ where: { customerId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    ]);
    if (lastMinute >= 2 || today >= 20) {
      res.status(429).json({ error: "Trop d'appels : patientez un instant avant de rappeler un Zed" });
      return;
    }
    const { latitude, longitude, accuracy, landmark } = parsed.data;
    let ride = null;
    for (let attempt = 0; !ride; attempt++) {
      try {
        ride = await prisma.zedRide.create({ data: { code: rideCode(), customerId, latitude, longitude, accuracy: accuracy ?? null, landmark: landmark || null } });
      } catch (e) {
        if (attempt >= 4 || (e as { code?: string }).code !== "P2002") throw e;
      }
    }
    await advanceRide(prisma, notifier, ride.id, now, s);
    const { customerId: _c, ...view } = await ownRide(ride.id, customerId);
    res.status(201).json(customerView(view));
  });

  // Course en cours (ou la dernière de moins d'une heure, pour la noter), à la réouverture de l'écran.
  router.get("/zed/current", async (_req, res) => {
    const customerId: string = res.locals.customerId;
    const ride = await prisma.zedRide.findFirst({
      where: { customerId, OR: [{ status: { in: [...RIDE_OPEN] } }, { status: "COMPLETED", rating: null, completedAt: { gte: new Date(Date.now() - 3_600_000) } }] },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!ride) {
      res.json(null);
      return;
    }
    await advanceRide(prisma, notifier, ride.id);
    const { customerId: _c, ...view } = await ownRide(ride.id, customerId);
    res.json(customerView(view));
  });

  // Interrogé toutes les 3 s par l'écran d'attente : fait passer l'appel au suivant après 15 s.
  router.get("/zed/:id", async (req, res) => {
    try {
      const customerId: string = res.locals.customerId;
      await ownRide(String(req.params.id), customerId);
      await advanceRide(prisma, notifier, String(req.params.id));
      const { customerId: _c, ...view } = await ownRide(String(req.params.id), customerId);
      res.json(customerView(view));
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/zed/:id/cancel", async (req, res) => {
    try {
      const customerId: string = res.locals.customerId;
      const ride = await ownRide(String(req.params.id), customerId);
      const now = new Date();
      const { count } = await prisma.zedRide.updateMany({
        where: { id: ride.id, status: { in: ["SEARCHING", "ACCEPTED"] } },
        data: { status: "CANCELLED", cancelledAt: now, cancelledBy: "CUSTOMER" },
      });
      if (!count) throw new HttpError(409, ride.status === "ONBOARD" ? "Vous êtes déjà à bord" : "Course déjà close");
      await prisma.zedOffer.updateMany({ where: { rideId: ride.id, status: "SENT" }, data: { status: "CANCELLED", respondedAt: now } });
      const driverId = (await prisma.zedRide.findUniqueOrThrow({ where: { id: ride.id }, select: { driverId: true } })).driverId;
      if (driverId) await notifier.push("driver", driverId, { title: "Course Zed annulée", body: "Le client a annulé sa demande.", url: "/livreur", tag: `zed-${ride.id}` });
      const { customerId: _c, ...view } = await ownRide(ride.id, customerId);
      res.json(customerView(view));
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/zed/:id/rating", async (req, res) => {
    const parsed = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(300).optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choisissez une note de 1 à 5" });
      return;
    }
    try {
      const customerId: string = res.locals.customerId;
      const ride = await ownRide(String(req.params.id), customerId);
      if (ride.status !== "COMPLETED") throw new HttpError(409, "La course n'est pas terminée");
      await prisma.zedRide.update({ where: { id: ride.id }, data: { rating: parsed.data.rating, ratingComment: parsed.data.comment || null } });
      const { customerId: _c, ...view } = await ownRide(ride.id, customerId);
      res.json(customerView(view));
    } catch (e) {
      sendError(res, e);
    }
  });
}

// --- Admin ---

export function adminZedRouter(prisma: PrismaClient, config: { notifier: Notifier; files?: FileStore }) {
  const router = Router();
  const { notifier } = config;
  const staffName = (res: Response) => (res.locals.staff as { name?: string } | undefined)?.name ?? "Direction";

  const driverSelect = {
    id: true,
    name: true,
    phone: true,
    plate: true,
    status: true,
    active: true,
    deliveries: true,
    zedStatus: true,
    zedAvailable: true,
    zedAppliedAt: true,
    zedReviewedAt: true,
    zedReviewedBy: true,
    zedNote: true,
    lastLocationAt: true,
    zedPayments: { select: { status: true, startsAt: true, endsAt: true } },
    zedDocuments: { select: { kind: true, createdAt: true } },
    _count: { select: { zedRides: { where: { status: "COMPLETED" } } } },
  } as const;

  router.get("/zed/summary", async (_req, res) => {
    const now = new Date();
    const [pendingDrivers, pendingPayments, drivers, rides, ratings] = await Promise.all([
      prisma.driver.count({ where: { zedStatus: "PENDING", deletedAt: null } }),
      prisma.zedPayment.count({ where: { status: "PENDING" } }),
      prisma.driver.findMany({ where: { zedStatus: "ACTIVE", deletedAt: null }, select: { zedAvailable: true, zedPayments: { select: { status: true, startsAt: true, endsAt: true } } } }),
      prisma.zedRide.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
      prisma.zedRide.aggregate({ _avg: { rating: true }, _count: { rating: true }, where: { rating: { not: null } } }),
    ]);
    const count = (s: string) => rides.find((r) => r.status === s)?._count._all ?? 0;
    res.json({
      pendingDrivers,
      pendingPayments,
      active: drivers.length,
      withPlan: drivers.filter((d) => activePlan(d.zedPayments, now)).length,
      available: drivers.filter((d) => d.zedAvailable && activePlan(d.zedPayments, now)).length,
      week: { total: rides.reduce((n, r) => n + r._count._all, 0), completed: count("COMPLETED"), noDriver: count("NO_DRIVER"), cancelled: count("CANCELLED") },
      rating: ratings._avg.rating ? Math.round(ratings._avg.rating * 10) / 10 : null,
      ratingCount: ratings._count.rating,
    });
  });

  router.get("/zed/drivers", async (req, res) => {
    const status = z.enum(["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"]).catch("PENDING").parse(req.query.status);
    const now = new Date();
    const drivers = await prisma.driver.findMany({ where: { zedStatus: status, deletedAt: null }, orderBy: { zedAppliedAt: "desc" }, select: driverSelect });
    res.json(drivers.map(({ zedPayments, _count, ...d }) => ({ ...d, planEndsAt: activePlan(zedPayments, now)?.endsAt ?? null, completedRides: _count.zedRides })));
  });

  router.get("/zed/drivers/:id", async (req, res) => {
    const now = new Date();
    const d = await prisma.driver.findUnique({ where: { id: String(req.params.id) }, select: { ...driverSelect, zedPayments: { orderBy: { createdAt: "desc" } } } });
    if (!d?.zedStatus) {
      res.status(404).json({ error: "Conducteur Zed introuvable" });
      return;
    }
    const rides = await prisma.zedRide.findMany({ where: { driverId: d.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, code: true, status: true, price: true, rating: true, createdAt: true } });
    const { _count, ...rest } = d;
    res.json({ ...rest, planEndsAt: activePlan(d.zedPayments, now)?.endsAt ?? null, completedRides: _count.zedRides, rides });
  });

  // Photo du dossier : servie seulement aux comptes de l'admin.
  router.get("/zed/drivers/:id/documents/:kind", async (req, res) => {
    const kind = String(req.params.kind).toUpperCase() as DocumentKind;
    const doc = await prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId: String(req.params.id), kind } } });
    const file = doc && config.files ? await config.files.get(doc.fileKey) : null;
    if (!file) {
      res.status(404).json({ error: "Photo introuvable" });
      return;
    }
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.end(Buffer.from(file.body instanceof Uint8Array ? file.body : new Uint8Array(file.body)));
  });

  // Vérification du dossier : APPROVE ouvre le mode Zed (et le premier mois offert), REJECT ou SUSPEND le ferment.
  router.post("/zed/drivers/:id/review", async (req, res) => {
    const parsed = z.object({ decision: z.enum(["APPROVE", "REJECT", "SUSPEND"]), note: z.string().trim().max(300).optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const id = String(req.params.id);
    const d = await prisma.driver.findUnique({ where: { id }, select: { id: true, name: true, status: true, deliveries: true, zedStatus: true, zedDocuments: { select: { kind: true } }, zedPayments: { select: { plan: true, status: true, startsAt: true, endsAt: true } } } });
    if (!d?.zedStatus) {
      res.status(404).json({ error: "Conducteur Zed introuvable" });
      return;
    }
    const now = new Date();
    const by = staffName(res);
    const { decision, note } = parsed.data;
    if (decision === "APPROVE") {
      const missing = REQUIRED_DOCUMENTS.filter((k) => !d.zedDocuments.some((doc) => doc.kind === k));
      if (missing.length) {
        res.status(400).json({ error: "Dossier incomplet : photo, pièce d'identité et permis obligatoires" });
        return;
      }
      // Conducteur Zed inscrit seul : son compte s'ouvre avec la validation.
      const account = d.status === "PENDING" ? { status: "APPROVED" as const, active: true } : {};
      await prisma.driver.update({ where: { id }, data: { ...account, zedStatus: "ACTIVE", zedReviewedAt: now, zedReviewedBy: by, zedNote: note || null } });
      const s = await getSettings(prisma);
      if (s.zedTrialDays > 0 && !d.zedPayments.some((p) => p.plan === "TRIAL")) {
        const period = nextPeriod(d.zedPayments, s.zedTrialDays, now);
        await prisma.zedPayment.create({ data: { driverId: id, plan: "TRIAL", days: s.zedTrialDays, amount: 0, method: "TRIAL", status: "CONFIRMED", ...period, reviewedAt: now, reviewedBy: by } });
      }
      await notifier.push("driver", id, { title: "Mode Zed activé", body: s.zedTrialDays > 0 ? `Votre dossier est validé. Premier mois offert.` : "Votre dossier est validé.", url: "/livreur", tag: "zed-review" });
    } else {
      const account = decision === "REJECT" && d.status === "PENDING" && !d.deliveries ? { status: "REJECTED" as const, active: false } : {};
      await prisma.driver.update({
        where: { id },
        data: { ...account, zedStatus: decision === "REJECT" ? "REJECTED" : "SUSPENDED", zedAvailable: false, zedReviewedAt: now, zedReviewedBy: by, zedNote: note || null },
      });
      await notifier.push("driver", id, { title: decision === "REJECT" ? "Dossier Zed refusé" : "Mode Zed suspendu", body: note || "Contactez Zedeka pour en savoir plus.", url: "/livreur", tag: "zed-review" });
    }
    res.json({ ok: true });
  });

  router.get("/zed/payments", async (req, res) => {
    const status = z.enum(["PENDING", "CONFIRMED", "REJECTED"]).catch("PENDING").parse(req.query.status);
    res.json(
      await prisma.zedPayment.findMany({
        where: { status, ...(status === "CONFIRMED" ? { method: { not: "TRIAL" } } : {}) },
        orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
        take: 100,
        include: { driver: { select: { id: true, name: true, phone: true, plate: true } } },
      }),
    );
  });

  // Référence vérifiée sur le relevé mobile money : CONFIRM ouvre (ou prolonge) la période du plan.
  router.post("/zed/payments/:id/review", async (req, res) => {
    const parsed = z.object({ decision: z.enum(["CONFIRM", "REJECT"]), note: z.string().trim().max(300).optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const p = await prisma.zedPayment.findUnique({ where: { id: String(req.params.id) } });
    if (!p || p.status !== "PENDING") {
      res.status(409).json({ error: "Paiement déjà traité" });
      return;
    }
    const now = new Date();
    const by = staffName(res);
    if (parsed.data.decision === "CONFIRM") {
      const others = await prisma.zedPayment.findMany({ where: { driverId: p.driverId, status: "CONFIRMED" }, select: { status: true, startsAt: true, endsAt: true } });
      const period = nextPeriod(others, p.days, now);
      await prisma.zedPayment.update({ where: { id: p.id }, data: { status: "CONFIRMED", ...period, reviewedAt: now, reviewedBy: by, note: parsed.data.note || null } });
      await notifier.push("driver", p.driverId, {
        title: "Plan Zed payé",
        body: `Paiement confirmé : plan valable jusqu'au ${period.endsAt.toLocaleDateString("fr-FR", { timeZone: "Africa/Lome" })}.`,
        url: "/livreur/zed",
        tag: "zed-plan",
      });
    } else {
      await prisma.zedPayment.update({ where: { id: p.id }, data: { status: "REJECTED", reviewedAt: now, reviewedBy: by, note: parsed.data.note || null } });
      await notifier.push("driver", p.driverId, { title: "Paiement Zed non retrouvé", body: parsed.data.note || "Vérifiez la référence ou contactez Zedeka.", url: "/livreur/zed", tag: "zed-plan" });
    }
    res.json({ ok: true });
  });

  router.get("/zed/rides", async (_req, res) => {
    res.json(
      await prisma.zedRide.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          code: true,
          status: true,
          landmark: true,
          price: true,
          rating: true,
          createdAt: true,
          acceptedAt: true,
          completedAt: true,
          cancelledBy: true,
          customer: { select: { name: true, phone: true } },
          driver: { select: { name: true, plate: true } },
          _count: { select: { offers: true } },
        },
      }),
    );
  });

  return router;
}
