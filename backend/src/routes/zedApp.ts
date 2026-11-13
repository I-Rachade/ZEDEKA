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
import { fetchRoute, kmBetween, MAX_ROUTE_KM, type RouteFetcher } from "../routing.js";
import {
  activePlan,
  advanceRide,
  freeZedDrivers,
  nextPeriod,
  offerExpiresAt,
  pendingOfferFor,
  MAX_SCHEDULED,
  REQUIRED_DOCUMENTS,
  RESERVE_GAP_MS,
  RIDE_OPEN,
  RIDE_SCHEDULED,
  RIDE_WITH_DRIVER,
  rankZedDrivers,
  zedPrice,
  rideCode,
  SCHEDULE_MAX_MS,
  scheduleError,
  withActivePlan,
  type DocumentKind,
} from "../zed.js";
import { HttpError } from "./adminWrite.js";
import { checkIdDates, idDatesInput, idStatus } from "../idExpiry.js";
import { driverPhotoUrl, photoInput, plateInput, storeDocuments } from "../driverDocuments.js";
import { driverByPhone, otpKey } from "./driverApp.js";

// Mode Zed côté conducteur (/api/livreur/zed), côté client (/api/customer/zed) et côté admin (/api/admin/zed).

const phoneInput = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numéro togolais invalide (8 chiffres)" });
    return z.NEVER;
  }
  return phone;
});
const photosInput = z.object({ SELFIE: photoInput, ID_CARD: photoInput, LICENCE: photoInput.optional(), MOTO: photoInput.optional() });

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
        idCard: idDatesInput,
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone, code, name, plate, pin, photos } = parsed.data;
    try {
      const idDates = checkIdDates(parsed.data.idCard);
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
      await storeDocuments(prisma, config.files, driver.id, photos, idDates);
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
  destination: true,
  mode: true,
  distanceM: true,
  quotedPrice: true,
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
  // Lomé vit à l'heure UTC : la journée commence à minuit UTC.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [offer, ride, payments, done] = await Promise.all([
    pendingOfferFor(prisma, notifier, driverId, now),
    prisma.zedRide.findFirst({ where: { driverId, status: { in: [...RIDE_WITH_DRIVER] } }, orderBy: { createdAt: "desc" }, select: rideForDriver }),
    prisma.zedPayment.findMany({ where: { driverId, status: "CONFIRMED" }, orderBy: { createdAt: "desc" }, take: 20, select: { status: true, startsAt: true, endsAt: true } }),
    prisma.zedRide.count({ where: { driverId, status: "COMPLETED", completedAt: { gte: today } } }),
  ]);
  const plan = activePlan(payments, now);
  // Plan en cours (date de fin) et courses terminées aujourd'hui, pour l'accueil du conducteur.
  return { offer, ride, planEndsAt: plan ? plan.endsAt.toISOString() : null, today: done };
}

export function zedDriverRoutes(router: Router, prisma: PrismaClient, config: DriverConfig) {
  const { notifier } = config;

  router.get("/zed", async (_req, res) => {
    res.json(await zedState(prisma, res.locals.driverId));
  });

  // Livreur indépendant déjà inscrit qui veut faire du Zed : plaque et photos, puis vérification par l'équipe.
  router.post("/zed/apply", async (req, res) => {
    const parsed = z.object({ plate: plateInput, photos: photosInput, idCard: idDatesInput, acceptTerms: z.literal(true, { errorMap: () => ({ message: "Acceptez les conditions des conducteurs Zed" }) }) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const driverId: string = res.locals.driverId;
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { name: true, employment: true, zedStatus: true } });
      if (driver.employment !== "FREELANCE") throw new HttpError(403, "Le mode Zed est réservé aux livreurs indépendants");
      if (driver.zedStatus && driver.zedStatus !== "REJECTED") throw new HttpError(409, "Vous êtes déjà inscrit au mode Zed");
      await storeDocuments(prisma, config.files, driverId, parsed.data.photos, checkIdDates(parsed.data.idCard));
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

  // Courses réservées à venir : celles encore libres (à moins de 10 km de la dernière position connue, si elle
  // existe) et celles que ce conducteur a retenues. Ni nom ni numéro du client avant l'heure.
  router.get("/zed/upcoming", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    const now = new Date();
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { zedStatus: true, lastLatitude: true, lastLongitude: true } });
    if (driver.zedStatus !== "ACTIVE") {
      res.json([]);
      return;
    }
    const rides = await prisma.zedRide.findMany({
      where: { status: RIDE_SCHEDULED, scheduledFor: { gt: now, lte: new Date(now.getTime() + SCHEDULE_MAX_MS) }, OR: [{ driverId: null }, { driverId }] },
      orderBy: { scheduledFor: "asc" },
      take: 50,
      select: { id: true, code: true, scheduledFor: true, landmark: true, destination: true, latitude: true, longitude: true, driverId: true },
    });
    const here = driver.lastLatitude !== null && driver.lastLongitude !== null ? { latitude: driver.lastLatitude, longitude: driver.lastLongitude } : null;
    res.json(
      rides
        .map((r) => ({ r, distanceM: here ? Math.round(distanceKm(here, r) * 1000) : null }))
        .filter(({ r, distanceM }) => r.driverId === driverId || distanceM === null || distanceM <= 10_000)
        .map(({ r, distanceM }) => ({
          id: r.id,
          code: r.code,
          scheduledFor: r.scheduledFor,
          landmark: r.landmark,
          destination: r.destination,
          distanceM,
          distance: distanceM !== null ? fmtDistance(distanceM) : null,
          mine: r.driverId === driverId,
        })),
    );
  });

  // Retenir une course réservée : dossier validé et plan en cours, et pas deux courses à moins d'une heure d'écart.
  router.post("/zed/upcoming/:id/reserve", async (req, res) => {
    try {
      const driverId: string = res.locals.driverId;
      const now = new Date();
      const driver = await prisma.driver.findFirst({ where: { id: driverId, zedStatus: "ACTIVE", active: true, ...withActivePlan(now) }, select: { name: true, plate: true } });
      if (!driver) throw new HttpError(403, "Plan Zed en cours et dossier validé nécessaires pour retenir une course");
      const ride = await prisma.zedRide.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true, driverId: true, scheduledFor: true, customerId: true } });
      if (!ride || ride.status !== RIDE_SCHEDULED || !ride.scheduledFor) throw new HttpError(404, "Course introuvable ou déjà partie");
      if (ride.driverId === driverId) {
        res.json({ ok: true });
        return;
      }
      const at = ride.scheduledFor.getTime();
      const clash = await prisma.zedRide.count({
        where: { driverId, status: RIDE_SCHEDULED, scheduledFor: { gt: new Date(at - RESERVE_GAP_MS), lt: new Date(at + RESERVE_GAP_MS) } },
      });
      if (clash) throw new HttpError(409, "Vous avez déjà une course réservée à moins d'une heure de celle-ci");
      const { count } = await prisma.zedRide.updateMany({ where: { id: ride.id, status: RIDE_SCHEDULED, driverId: null }, data: { driverId } });
      if (!count) throw new HttpError(409, "Un autre Zed vient de retenir cette course");
      const time = ride.scheduledFor.toISOString().slice(11, 16);
      void notifier
        .push("customer", ride.customerId, { title: "Zed réservé", body: `${driver.name} (${driver.plate ?? "moto"}) viendra vous chercher à ${time}.`, url: "/app/zed", tag: `zed-${ride.id}` })
        .catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  // Se désister d'une course retenue (jusqu'à 15 min avant l'heure) : elle redevient libre pour les autres Zed.
  router.post("/zed/upcoming/:id/release", async (req, res) => {
    try {
      const driverId: string = res.locals.driverId;
      const ride = await prisma.zedRide.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true, driverId: true, scheduledFor: true, customerId: true } });
      if (!ride || ride.driverId !== driverId) throw new HttpError(404, "Course introuvable");
      const { count } = await prisma.zedRide.updateMany({ where: { id: ride.id, status: RIDE_SCHEDULED, driverId }, data: { driverId: null } });
      if (!count) throw new HttpError(409, "L'heure est arrivée : la course est déjà à vous, annulez-la depuis la course en cours");
      void notifier
        .push("customer", ride.customerId, { title: "Votre Zed s'est désisté", body: "Votre course reste réservée : un autre Zed peut la prendre, sinon l'appel part 15 min avant.", url: "/app/zed", tag: `zed-${ride.id}` })
        .catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
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
  destination: true,
  mode: true,
  distanceM: true,
  quotedPrice: true,
  scheduledFor: true,
  createdAt: true,
  acceptedAt: true,
  onboardAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  rating: true,
  ratingComment: true,
  price: true,
  driver: { select: { id: true, name: true, phone: true, plate: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true, zedDocuments: { where: { kind: "SELFIE" }, select: { id: true } } } },
  _count: { select: { offers: true } },
} as const;

type RideDriver = { id?: string; name: string; phone: string; plate: string | null; lastLatitude: number | null; lastLongitude: number | null; lastLocationAt: Date | null; zedDocuments?: { id: string }[] };
function customerView(r: Record<string, unknown> & { status: string; latitude: number; longitude: number; driver: RideDriver | null; _count: { offers: number } }, secret = "") {
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
          // Photo de profil (lien signé) : le client reconnaît son conducteur.
          photoUrl: driver.id && secret && driver.zedDocuments?.length && (live || r.status === "SCHEDULED") ? driverPhotoUrl(secret, driver.id) : null,
          phone: live ? driver.phone : null,
          latitude: live ? driver.lastLatitude : null,
          longitude: live ? driver.lastLongitude : null,
          distanceM,
          distance: distanceM !== null ? fmtDistance(distanceM) : null,
        }
      : null,
  };
}

export type RoutingConfig = { routingUrl?: string; routeFetcher?: RouteFetcher; routeTimeoutMs?: number };

// Itinéraire d'une course demandée : longueur et durée par la route (serveur d'itinéraires), sinon à vol
// d'oiseau majoré de 30 % à 20 km/h, pour que le client ait toujours un prix.
async function tripLength(from: GeoPoint, to: GeoPoint, routing: RoutingConfig): Promise<{ distanceM: number; durationS: number }> {
  try {
    const route = await fetchRoute(from, to, { baseUrl: routing.routingUrl, fetcher: routing.routeFetcher, timeoutMs: routing.routeTimeoutMs ?? 8_000 });
    if (route) return { distanceM: Math.round(route.distanceM), durationS: Math.round(route.durationS) };
  } catch {
    // service indisponible : estimation ci-dessous
  }
  const distanceM = Math.round(kmBetween(from, to) * 1000 * 1.3);
  return { distanceM, durationS: Math.round(distanceM / (20_000 / 3600)) };
}
type GeoPoint = { latitude: number; longitude: number };

export function zedCustomerRoutes(router: Router, prisma: PrismaClient, notifier: Notifier, routing: RoutingConfig = {}, secret = "") {
  // Prix d'une course demandée, de la position de départ à la destination.
  async function quote(from: GeoPoint, to: GeoPoint) {
    if (kmBetween(from, to) > MAX_ROUTE_KM) throw new HttpError(400, "Destination trop éloignée");
    const [trip, s] = await Promise.all([tripLength(from, to, routing), getSettings(prisma)]);
    return { ...trip, price: zedPrice(trip.distanceM, s) };
  }

  router.get("/zed/quote", async (req, res) => {
    const n = (min: number, max: number) => z.coerce.number().min(min).max(max);
    const parsed = z
      .object({ fromLatitude: n(-90, 90), fromLongitude: n(-180, 180), toLatitude: n(-90, 90), toLongitude: n(-180, 180) })
      .safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Départ et destination nécessaires pour le prix" });
      return;
    }
    const q = parsed.data;
    res.set("Cache-Control", "private, max-age=60").json(await quote({ latitude: q.fromLatitude, longitude: q.fromLongitude }, { latitude: q.toLatitude, longitude: q.toLongitude }));
  });

  async function ownRide(id: string, customerId: string) {
    const ride = await prisma.zedRide.findUnique({ where: { id }, select: { ...rideForCustomer, customerId: true } });
    if (!ride || ride.customerId !== customerId) throw new HttpError(404, "Course introuvable");
    return ride;
  }

  // Nouvelle course réservée : prévient les conducteurs Zed en service (plan en cours) vus à moins de 10 km ces
  // dernières 24 h, qui peuvent la retenir depuis leur appli. Sans sonnerie : ce n'est pas un appel immédiat.
  async function announceScheduled(rideId: string, at: Date, latitude: number, longitude: number, now: Date) {
    const drivers = await prisma.driver.findMany({
      where: { zedStatus: "ACTIVE", active: true, status: "APPROVED", deletedAt: null, lastLocationAt: { gte: new Date(now.getTime() - 86_400_000) }, ...withActivePlan(now) },
      select: { id: true, lastLatitude: true, lastLongitude: true },
      take: 200,
    });
    const day = at.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) ? "aujourd'hui" : `le ${at.toISOString().slice(8, 10)}/${at.toISOString().slice(5, 7)}`;
    const time = at.toISOString().slice(11, 16);
    for (const d of drivers) {
      if (d.lastLatitude === null || d.lastLongitude === null || distanceKm({ latitude, longitude }, { latitude: d.lastLatitude, longitude: d.lastLongitude }) > 10) continue;
      void notifier.push("driver", d.id, { title: `Course réservée ${day} à ${time}`, body: "Retenez-la dans « Courses à venir » si vous êtes libre.", url: "/livreur", tag: `zed-plan-${rideId}` }).catch(() => {});
    }
  }

  // Courses réservées du client, de la plus proche à la plus lointaine. Déclaré avant /zed/:id.
  router.get("/zed/scheduled", async (_req, res) => {
    const customerId: string = res.locals.customerId;
    const rides = await prisma.zedRide.findMany({ where: { customerId, status: RIDE_SCHEDULED }, orderBy: { scheduledFor: "asc" }, take: MAX_SCHEDULED, select: rideForCustomer });
    res.json(rides.map((r) => customerView(r, secret)));
  });

  // Appeler un Zed : la position du client est obligatoire, la destination facultative (texte libre).
  router.post("/zed", async (req, res) => {
    const parsed = z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100_000).optional(),
        landmark: z.string().trim().max(120).optional(),
        destination: z.string().trim().max(120).optional(),
        destinationLatitude: z.number().min(-90).max(90).optional(),
        destinationLongitude: z.number().min(-180).max(180).optional(),
        // « Demander une course » (destination obligatoire, prix de l'itinéraire) plutôt qu'« Appeler un Zed ».
        mode: z.enum(["CALL", "REQUEST"]).optional(),
        // Course réservée à l'avance (ISO) : jour et heure choisis par le client.
        scheduledFor: z.string().datetime({ offset: true }).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Partagez votre position pour appeler un Zed" });
      return;
    }
    const scheduledFor = parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null;
    const customerId: string = res.locals.customerId;
    const s = await getSettings(prisma);
    if (!s.zedEnabled) {
      res.status(503).json({ error: "Le service Zed n'est pas encore ouvert" });
      return;
    }
    const now = new Date();
    if (scheduledFor) {
      const wrong = scheduleError(scheduledFor, now);
      if (wrong || !parsed.data.destination) {
        res.status(400).json({ error: wrong ?? "Indiquez où vous allez pour réserver une course" });
        return;
      }
      if ((await prisma.zedRide.count({ where: { customerId, status: RIDE_SCHEDULED } })) >= MAX_SCHEDULED) {
        res.status(409).json({ error: `${MAX_SCHEDULED} courses réservées au plus : annulez-en une d'abord` });
        return;
      }
    }
    // Une course réservée n'empêche pas d'appeler un Zed maintenant, et inversement.
    const open = scheduledFor ? null : await prisma.zedRide.findFirst({ where: { customerId, status: { in: [...RIDE_OPEN] } }, select: { id: true } });
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
    const { latitude, longitude, accuracy, landmark, destination, destinationLatitude, destinationLongitude } = parsed.data;
    // Course programmée ou demandée : destination obligatoire ; avec son point, le prix de l'itinéraire est fixé.
    const mode = scheduledFor || parsed.data.mode === "REQUEST" ? "REQUEST" : "CALL";
    if (mode === "REQUEST" && !destination) {
      res.status(400).json({ error: "Indiquez votre destination pour demander une course" });
      return;
    }
    const to = destinationLatitude !== undefined && destinationLongitude !== undefined ? { latitude: destinationLatitude, longitude: destinationLongitude } : null;
    const trip = mode === "REQUEST" && to ? await quote({ latitude, longitude }, to).catch(() => null) : null;
    let ride = null;
    for (let attempt = 0; !ride; attempt++) {
      try {
        ride = await prisma.zedRide.create({
          data: {
            code: rideCode(),
            customerId,
            latitude,
            longitude,
            accuracy: accuracy ?? null,
            landmark: landmark || null,
            destination: destination || null,
            mode,
            destinationLatitude: to?.latitude ?? null,
            destinationLongitude: to?.longitude ?? null,
            distanceM: trip?.distanceM ?? null,
            quotedPrice: trip?.price ?? null,
            ...(scheduledFor ? { scheduledFor, status: RIDE_SCHEDULED } : {}),
          },
        });
      } catch (e) {
        if (attempt >= 4 || (e as { code?: string }).code !== "P2002") throw e;
      }
    }
    if (scheduledFor) void announceScheduled(ride.id, scheduledFor, latitude, longitude, now).catch(() => {});
    else await advanceRide(prisma, notifier, ride.id, now, s);
    const { customerId: _c, ...view } = await ownRide(ride.id, customerId);
    res.status(201).json(customerView(view, secret));
  });

  // Zed libres autour du client, pour la carte avant l'appel : nombre dans le rayon, minutes d'approche du plus
  // proche, et positions arrondies à ~100 m (jamais l'identité ni la position exacte d'un conducteur).
  router.get("/zed/nearby", async (req, res) => {
    const parsed = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180) }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Position invalide" });
      return;
    }
    const s = await getSettings(prisma);
    if (!s.zedEnabled) {
      res.json({ count: 0, radiusM: s.zedRadiusM, etaMin: null, drivers: [] });
      return;
    }
    const now = new Date();
    const free = await freeZedDrivers(prisma, now);
    const ranked = rankZedDrivers(free, parsed.data, s.zedRadiusM, now);
    const byId = new Map(free.map((d) => [d.id, d]));
    const round = (v: number) => Math.round(v * 1000) / 1000;
    res.json({
      count: ranked.length,
      radiusM: s.zedRadiusM,
      // Moto en ville : environ 300 m par minute, une minute au moins.
      etaMin: ranked.length ? Math.max(1, Math.round(ranked[0].distanceM / 300)) : null,
      drivers: ranked.slice(0, 8).map((r) => ({ latitude: round(byId.get(r.id)!.lastLatitude!), longitude: round(byId.get(r.id)!.lastLongitude!) })),
    });
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
    res.json(customerView(view, secret));
  });

  // Historique des courses du client (volet « Courses » de Mes commandes), du plus récent au plus ancien.
  // Déclaré avant /zed/:id. Ni numéro ni position du conducteur : la course est close ou s'affiche ailleurs.
  router.get("/zed/rides", async (_req, res) => {
    const customerId: string = res.locals.customerId;
    const rides = await prisma.zedRide.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        code: true,
        status: true,
        landmark: true,
        destination: true,
        scheduledFor: true,
        createdAt: true,
        acceptedAt: true,
        onboardAt: true,
        completedAt: true,
        cancelledAt: true,
        cancelledBy: true,
        price: true,
        rating: true,
        driver: { select: { name: true, plate: true } },
      },
    });
    res.json(rides.map((r) => ({ ...r, ongoing: (RIDE_OPEN as readonly string[]).includes(r.status), driver: r.driver && { name: r.driver.name.split(" ")[0], plate: r.driver.plate } })));
  });

  // Interrogé toutes les 3 s par l'écran d'attente : fait passer l'appel au suivant après 15 s.
  router.get("/zed/:id", async (req, res) => {
    try {
      const customerId: string = res.locals.customerId;
      await ownRide(String(req.params.id), customerId);
      await advanceRide(prisma, notifier, String(req.params.id));
      const { customerId: _c, ...view } = await ownRide(String(req.params.id), customerId);
      res.json(customerView(view, secret));
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
        where: { id: ride.id, status: { in: ["SEARCHING", "ACCEPTED", RIDE_SCHEDULED] } },
        data: { status: "CANCELLED", cancelledAt: now, cancelledBy: "CUSTOMER" },
      });
      if (!count) throw new HttpError(409, ride.status === "ONBOARD" ? "Vous êtes déjà à bord" : "Course déjà close");
      await prisma.zedOffer.updateMany({ where: { rideId: ride.id, status: "SENT" }, data: { status: "CANCELLED", respondedAt: now } });
      const driverId = (await prisma.zedRide.findUniqueOrThrow({ where: { id: ride.id }, select: { driverId: true } })).driverId;
      if (driverId) await notifier.push("driver", driverId, { title: "Course Zed annulée", body: "Le client a annulé sa demande.", url: "/livreur", tag: `zed-${ride.id}` });
      const { customerId: _c, ...view } = await ownRide(ride.id, customerId);
      res.json(customerView(view, secret));
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
      res.json(customerView(view, secret));
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
    zedDocuments: { select: { kind: true, createdAt: true, issuedAt: true, expiresAt: true } },
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
    const d = await prisma.driver.findUnique({ where: { id }, select: { id: true, name: true, status: true, deliveries: true, zedStatus: true, zedDocuments: { select: { kind: true, expiresAt: true } }, zedPayments: { select: { plan: true, status: true, startsAt: true, endsAt: true } } } });
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
        res.status(400).json({ error: "Dossier incomplet : photo et pièce d'identité obligatoires" });
        return;
      }
      const idCard = d.zedDocuments.find((doc) => doc.kind === "ID_CARD");
      if (idStatus(idCard?.expiresAt, now) === "EXPIRED") {
        res.status(400).json({ error: "Pièce d'identité expirée : demandez au conducteur d'envoyer la nouvelle" });
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
      // Deux validations en même temps (double clic, deux membres de l'équipe) : une seule ouvre la période.
      const { count } = await prisma.zedPayment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "CONFIRMED", ...period, reviewedAt: now, reviewedBy: by, note: parsed.data.note || null } });
      if (!count) {
        res.status(409).json({ error: "Paiement déjà traité" });
        return;
      }
      await notifier.push("driver", p.driverId, {
        title: "Plan Zed payé",
        body: `Paiement confirmé : plan valable jusqu'au ${period.endsAt.toLocaleDateString("fr-FR", { timeZone: "Africa/Lome" })}.`,
        url: "/livreur/zed",
        tag: "zed-plan",
      });
    } else {
      const { count } = await prisma.zedPayment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: now, reviewedBy: by, note: parsed.data.note || null } });
      if (!count) {
        res.status(409).json({ error: "Paiement déjà traité" });
        return;
      }
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
