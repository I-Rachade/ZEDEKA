import { type Response, Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { fetchRoute, kmBetween, MAX_ROUTE_KM, parsePoint, type RouteFetcher } from "../routing.js";
import { CUSTOMER_TOKEN_TTL_MS, issueToken, requireDriver, revokedLongToken } from "../auth.js";
import { normalizePhone, phoneTail } from "../customer.js";
import { ASSIGNMENT_TIMEOUT_MS, canDriverMove, cashDue, checkCash, earningsSummary, eventTime, ISSUE_KINDS, OFFLINE_AFTER_MS } from "../driver.js";
import type { Notifier } from "../notify.js";
import { OPEN, statusUpdate } from "../orderFlow.js";
import { alertLowDeposit, depositCost, paidByDriverOnSite } from "../deposit.js";
import { formatFcfa } from "../pricing.js";
import { closeDelivery, codeMatches } from "../receipt.js";
import { HttpError } from "./adminWrite.js";
import { requestEmailOtp, requestOtp, verifyOtp, type PhoneVerifier } from "../otp.js";
import { checkPin, hashPin, newPinInput, PIN_LOCK_MS, PIN_MAX_ATTEMPTS, PIN_RESET_WINDOW_MS, reservePinAttempt } from "../pin.js";
import { pushRoutes } from "./partnerAccount.js";
import type { EmailSender } from "../email.js";
import { langOf } from "../i18n.js";
import { emailInput, firstError } from "../util.js";
import { notifyCustomer } from "../customerNotify.js";
import type { FileStore } from "../storage.js";
import { zedCurrent, zedDriverRoutes, zedSignupRoutes } from "./zedApp.js";
import { missionsSummary, serviceProviderRoutes } from "./serviceApp.js";
import { deleteDriverAccount } from "../accountDeletion.js";
import { confirmSlot, DEFAULT_SLOT_OFFER_SECONDS, hhmm, isSlotOffer, offerTimeoutMs, onSlotReserved, PICKUP_LEAD_MS, releaseSlot, SLOT_GAP_MS } from "../scheduledPickup.js";
import { assignMotorbike, needsMotorbike, releaseAtEndOfShift } from "../fleet.js";
import { missingDocuments } from "../driverDocuments.js";
import { driverKitRoutes } from "./driverKit.js";

// Application livreur (/api/livreur) : connexion par numéro et code PIN (code SMS pour le PIN oublié), courses proposées par la répartition,
// étapes de livraison, espèces, gains, position et signalement de problème.

type Config = {
  secret: string;
  notifier: Notifier;
  devCodes: boolean;
  verifier?: PhoneVerifier;
  dispatchPhone: string;
  email?: EmailSender;
  files?: FileStore;
  // Service d'itinéraire (compatible OSRM) de l'écran « Naviguer » ; fetcher remplacé dans les tests.
  routingUrl?: string;
  routeFetcher?: RouteFetcher;
  // Délai d'attente d'un itinéraire : plus long avec notre serveur, qui peut être en train de démarrer.
  routeTimeoutMs?: number;
};

const phoneInput = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numéro togolais invalide (8 chiffres)" });
    return z.NEVER;
  }
  return phone;
});

// Formulaires de connexion : le message seul (« Le code PIN a 4 chiffres »), sans le nom du champ devant.
function plainError(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue && !(issue.code === "invalid_type" && issue.received === "undefined") ? issue.message : firstError(error);
}

// Les codes livreur sont rangés à part de ceux des clients (même table, clé préfixée).
export const otpKey = (phone: string) => `driver:${phone}`;
const emailKey = (email: string) => `driver:email:${email}`;

// Livreur dont le numéro (enregistré tel quel à la candidature) finit par les mêmes 8 chiffres.
export async function driverByPhone(prisma: PrismaClient, phone: string) {
  const tail = phoneTail(phone);
  // Les numéros sont gardés tels que saisis (« 93 44 55 66 ») : on présélectionne sur les 2 derniers chiffres,
  // toujours collés, puis on compare les 8 derniers chiffres sans espaces.
  const candidates = await prisma.driver.findMany({ where: { phone: { endsWith: tail.slice(-2) } } });
  return candidates.find((d) => d.phone.replace(/\D/g, "").slice(-8) === tail) ?? null;
}

const orderSelect = {
  id: true,
  code: true,
  type: true,
  status: true,
  customerName: true,
  customerPhone: true,
  address: true,
  latitude: true,
  longitude: true,
  locationSource: true,
  locationRequest: { select: { status: true, accuracyM: true } },
  note: true,
  pickupAddress: true,
  pickupLatitude: true,
  pickupAt: true,
  pickupLongitude: true,
  recipientName: true,
  recipientPhone: true,
  weightKg: true,
  parcelSize: true,
  parcelCategory: { select: { name: true } },
  paymentMethod: true,
  paymentStatus: true,
  payer: true,
  total: true,
  subtotal: true,
  commission: true,
  fulfillment: true,
  restaurantId: true,
  deliveryFee: true,
  extraFee: true,
  driverEarning: true,
  cashCollected: true,
  cashNote: true,
  prepMinutes: true,
  createdAt: true,
  confirmedAt: true,
  readyAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  handedOverAt: true,
  closedBy: true,
  receiptDisputedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  distanceKm: true,
  discount: true,
  promoCode: true,
  restaurantMessage: true,
  restaurantMessageAt: true,
  zone: { select: { name: true } },
  restaurant: { select: { name: true, phone: true, address: true, latitude: true, longitude: true, _count: { select: { deposits: true } } } },
  items: { select: { name: true, variantName: true, quantity: true } },
} satisfies Prisma.OrderSelect;

type DriverOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
// restaurantPay : ce que le livreur indépendant paie au restaurant en retirant un repas (restaurant avec un dépôt
// Zedeka) ; Zedeka le retient sur les espèces qu'il remet.
const withCash = (o: DriverOrder, employment: "STAFF" | "FREELANCE" | null) => ({
  ...o,
  cashDue: cashDue(o),
  restaurantPay: paidByDriverOnSite(o, (o.restaurant?._count.deposits ?? 0) > 0, employment) ? depositCost(o) : 0,
});
const employmentOf = async (prisma: PrismaClient, driverId: string) =>
  (await prisma.driver.findUnique({ where: { id: driverId }, select: { employment: true } }))?.employment === "STAFF" ? ("STAFF" as const) : ("FREELANCE" as const);

// Courses proposées restées sans réponse : retirées au livreur et signalées à la répartition.
// Réservation d'un retrait programmé : 3 min (réglage slotOfferSeconds) au lieu de 60 s.
export async function expireAssignments(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const candidates = await prisma.driverAssignment.findMany({
    where: { status: "SENT", createdAt: { lt: new Date(now.getTime() - ASSIGNMENT_TIMEOUT_MS) } },
    select: { id: true, orderId: true, driverId: true, createdAt: true, driver: { select: { name: true } }, order: { select: { code: true, pickupAt: true } } },
  });
  const slotSeconds = candidates.some((a) => isSlotOffer(a.order.pickupAt, a.createdAt)) ? await slotOfferSeconds(prisma) : DEFAULT_SLOT_OFFER_SECONDS;
  const late = candidates.filter((a) => now.getTime() - a.createdAt.getTime() > offerTimeoutMs(a.order.pickupAt, a.createdAt, slotSeconds));
  for (const a of late) {
    const { count } = await prisma.driverAssignment.updateMany({ where: { id: a.id, status: "SENT" }, data: { status: "EXPIRED", respondedAt: now, reason: "Pas de réponse" } });
    if (!count) continue;
    await prisma.order.updateMany({ where: { id: a.orderId, driverId: a.driverId, status: { in: OPEN } }, data: { driverId: null } });
    await notifier.staff("DRIVERS", {
      title: `Course non acceptée : ${a.order.code}`,
      body: `${a.driver.name} n'a pas répondu à temps. À réaffecter.`,
      url: "/admin/dispatch",
      tag: `assign-${a.orderId}`,
      alarm: true,
    });
  }
  return late.length;
}

export async function slotOfferSeconds(prisma: PrismaClient) {
  return (await prisma.settings.findUnique({ where: { id: 1 }, select: { slotOfferSeconds: true } }))?.slotOfferSeconds ?? DEFAULT_SLOT_OFFER_SECONDS;
}

// Réponse du livreur à une proposition : écrite seulement si elle attend encore (status SENT). D1 n'a pas de
// transactions : lire puis écrire laisserait passer une proposition retirée ou expirée entre les deux.
export async function answerAssignment(
  prisma: PrismaClient,
  id: string,
  data: { status: "ACCEPTED" | "REJECTED"; respondedAt: Date; reason?: string },
): Promise<boolean> {
  const { count } = await prisma.driverAssignment.updateMany({ where: { id, status: "SENT" }, data });
  return count > 0;
}

// Livreurs « en ligne » dont l'application ne donne plus signe de vie.
export async function autoOffline(prisma: PrismaClient, now = new Date()) {
  const silent = { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - OFFLINE_AFTER_MS) } }] };
  const { count } = await prisma.driver.updateMany({ where: { online: true, ...silent }, data: { online: false } });
  // Même chose pour « Disponible pour les Zed ».
  await prisma.driver.updateMany({ where: { zedAvailable: true, ...silent }, data: { zedAvailable: false } });
  return count;
}

// Affectation par la répartition : l'ancienne proposition est retirée, la nouvelle envoyée au livreur.
// assignedBy : nom du membre de l'équipe qui attribue, montré dans la répartition.
export async function assignDriver(
  prisma: PrismaClient,
  notifier: Notifier,
  order: { id: string; code: string; driverId: string | null },
  driverId: string | null,
  assignedBy: string | null = null,
  now = new Date(),
) {
  if (order.driverId === driverId) return;
  await prisma.driverAssignment.updateMany({ where: { orderId: order.id, status: { in: ["SENT", "ACCEPTED"] } }, data: { status: "WITHDRAWN", respondedAt: now } });
  // Nouveau livreur (ou plus personne) : rappel, confirmation et début du créneau repartent de zéro.
  await prisma.order.updateMany({ where: { id: order.id }, data: { slotReminderAt: null, slotConfirmedAt: null, slotStartedAt: null } });
  if (!driverId) return;
  // Retrait programmé dans plus de 30 min : c'est une réservation, le livreur reste libre jusqu'à l'heure.
  const pickupAt = (await prisma.order.findUnique({ where: { id: order.id }, select: { pickupAt: true } }))?.pickupAt ?? null;
  const slot = isSlotOffer(pickupAt, now);
  // Un salarié de Zedeka ne choisit pas : la course lui est attribuée d'office, sans délai de réponse.
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { employment: true } });
  if (driver?.employment === "STAFF") {
    await prisma.driverAssignment.create({ data: { orderId: order.id, driverId, status: "ACCEPTED", respondedAt: now, assignedBy } });
    await notifier.push("driver", driverId, {
      title: slot ? `Retrait programmé ${order.code} à ${hhmm(pickupAt!)}` : `Course attribuée : ${order.code}`,
      body: slot ? "Le dispatch vous a réservé ce retrait. Vous restez libre jusqu'à l'heure." : "Le dispatch vous a attribué une course. Ouvrez l'application.",
      url: "/livreur",
      tag: `offer-${order.id}`,
      alarm: true,
    });
    if (slot) await onSlotReserved(prisma, notifier, order.id, driverId, now);
    return;
  }
  await prisma.driverAssignment.create({ data: { orderId: order.id, driverId, assignedBy } });
  const minutes = slot ? Math.max(1, Math.round((await slotOfferSeconds(prisma)) / 60)) : 0;
  await notifier.push("driver", driverId, {
    title: slot ? `Retrait programmé ${order.code} à ${hhmm(pickupAt!)}` : `Nouvelle course ${order.code}`,
    body: slot ? `Réservez-le : vous restez libre jusqu'à l'heure. Répondez dans les ${minutes} min.` : "Acceptez ou refusez dans les 60 secondes.",
    url: "/livreur",
    tag: `offer-${order.id}`,
    alarm: true,
  });
}

const statusInput = z.object({
  status: z.enum(["PICKED_UP", "DELIVERED"]),
  at: z.string().max(40).optional(),
  cashCollected: z.number().int().min(0).max(10_000_000).optional(),
  cashNote: z.string().trim().max(300).optional(),
  // Code à 4 chiffres donné par le client : la livraison est clôturée sur place.
  code: z.string().trim().max(10).optional(),
});

const locationInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  orderId: z.string().optional(),
});

const issueInput = z.object({
  orderId: z.string().optional(),
  kind: z.enum(Object.keys(ISSUE_KINDS) as [keyof typeof ISSUE_KINDS, ...(keyof typeof ISSUE_KINDS)[]]),
  note: z.string().trim().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export function driverAppRouter(prisma: PrismaClient, config: Config) {
  const router = Router();
  const { notifier } = config;

  // Identité vérifiée (PIN ou code SMS). Candidature pas encore validée, refusée ou compte suspendu :
  // on montre où elle en est, sans ouvrir l'application.
  async function open(
    res: Response,
    driver: { id: string; name: string; phone: string; status: string; active: boolean; createdAt: Date; pinHash: string | null; deliveries?: boolean; zedStatus?: string | null },
  ) {
    if (driver.status !== "APPROVED" || !driver.active) {
      const status = driver.status === "APPROVED" ? "SUSPENDED" : driver.status;
      // Conducteur Zed inscrit seul : l'écran de candidature parle de son dossier Zed.
      const zed = driver.deliveries === false && Boolean(driver.zedStatus);
      res.json({ application: { name: driver.name, status, createdAt: driver.createdAt, ...(zed ? { zed: true } : {}) } });
      return;
    }
    await prisma.driver.update({ where: { id: driver.id }, data: { lastSeenAt: new Date() } });
    res.json({
      token: issueToken(config.secret, Date.now(), "driver", driver.id, CUSTOMER_TOKEN_TTL_MS),
      driver: { name: driver.name, phone: driver.phone, hasPin: !!driver.pinHash },
    });
  }

  router.post("/otp/request", async (req, res) => {
    const parsed = z.object({ phone: phoneInput }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone } = parsed.data;
    const driver = await driverByPhone(prisma, phone);
    if (!driver) {
      res.status(404).json({ error: "Aucun livreur n'est inscrit avec ce numéro.", apply: true });
      return;
    }
    const result = await requestOtp(prisma, config, otpKey(phone), phone, "L'envoi des codes n'est pas encore disponible. Appelez la répartition.");
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json(result.body);
  });

  router.post("/otp/verify", async (req, res) => {
    const parsed = z.object({ phone: phoneInput, code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres") }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone, code } = parsed.data;
    const checked = await verifyOtp(prisma, config, otpKey(phone), phone, code);
    if (!checked.ok) {
      res.status(checked.status).json(checked.body);
      return;
    }
    const driver = await driverByPhone(prisma, phone);
    if (!driver) {
      res.status(404).json({ error: "Aucun livreur n'est inscrit avec ce numéro.", apply: true });
      return;
    }
    // Code SMS vérifié : le livreur peut choisir un nouveau PIN sans l'ancien pendant quelques minutes.
    await prisma.driver.update({ where: { id: driver.id }, data: { pinAttempts: 0, pinLockedUntil: null, pinResetUntil: new Date(Date.now() + PIN_RESET_WINDOW_MS) } });
    open(res, driver);
  });

  // Connexion par numéro et code PIN, comme les clients.
  // Avec le numéro ou l'e-mail du compte.
  router.post("/pin/login", async (req, res) => {
    const pin = z.string().regex(/^\d{4}$/, "Le code PIN a 4 chiffres");
    const parsed = z.union([z.object({ phone: phoneInput, pin }), z.object({ email: emailInput, pin })]).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: plainError(parsed.error) });
      return;
    }
    const driver = "phone" in parsed.data ? await driverByPhone(prisma, parsed.data.phone) : await prisma.driver.findUnique({ where: { email: parsed.data.email } });
    // Même réponse pour un compte inconnu ou un PIN faux : on ne révèle pas quels numéros ou e-mails sont inscrits.
    const wrong = "Identifiant ou code PIN incorrect";
    if (!driver) {
      res.status(400).json({ error: wrong });
      return;
    }
    if (!driver.pinHash) {
      res.status(400).json({ error: "Pas encore de code PIN pour ce compte. Recevez un code par SMS pour le créer, ou demandez-le à la répartition.", noPin: true });
      return;
    }
    // Essai réservé avant la comparaison : des essais en rafale ne contournent plus le blocage.
    const reserved = await reservePinAttempt(driver, {
      clearExpired: (until) => prisma.driver.updateMany({ where: { id: driver.id, pinLockedUntil: until }, data: { pinAttempts: 0, pinLockedUntil: null } }),
      bump: () => prisma.driver.update({ where: { id: driver.id }, data: { pinAttempts: { increment: 1 } }, select: { pinAttempts: true, pinLockedUntil: true } }),
      lock: () => prisma.driver.update({ where: { id: driver.id }, data: { pinAttempts: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MS) } }),
    });
    if (!reserved.ok) {
      res.status(429).json({ error: `Trop d'essais. Réessayez dans ${reserved.minutes} min ou choisissez « Code PIN oublié ».` });
      return;
    }
    if (!(await checkPin(parsed.data.pin, driver.pinHash))) {
      if (reserved.attempts >= PIN_MAX_ATTEMPTS) {
        await prisma.driver.update({ where: { id: driver.id }, data: { pinAttempts: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MS) } });
        res.status(429).json({ error: "Trop d'essais. Réessayez dans 15 min ou choisissez « Code PIN oublié »." });
        return;
      }
      res.status(400).json({ error: wrong });
      return;
    }
    await prisma.driver.update({ where: { id: driver.id }, data: { pinAttempts: 0, pinLockedUntil: null } });
    open(res, driver);
  });

  // PIN oublié par e-mail : code envoyé à l'adresse du livreur. Réponse identique si l'adresse est inconnue.
  router.post("/email/request", async (req, res) => {
    const parsed = z.object({ email: emailInput }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: plainError(parsed.error) });
      return;
    }
    const { email } = parsed.data;
    const driver = await prisma.driver.findUnique({ where: { email }, select: { id: true } });
    if (!driver) {
      if (!config.email && !config.devCodes) {
        res.status(503).json({ error: "L'envoi par e-mail n'est pas encore disponible. Recevez le code par SMS." });
        return;
      }
      res.json({ email, expiresInMinutes: 10 });
      return;
    }
    const en = langOf(req) === "en";
    const result = await requestEmailOtp(prisma, config, emailKey(email), email, (code) =>
      en
        ? { subject: `Your Zedeka rider code: ${code}`, text: `Your Zedeka code is ${code}. It is valid for 10 minutes.\n\nIf you didn't ask for it, ignore this email: your PIN stays the same.` }
        : { subject: `Votre code Zedeka Livreur : ${code}`, text: `Votre code Zedeka est ${code}. Il est valable 10 minutes.\n\nSi vous ne l'avez pas demandé, ignorez cet e-mail : votre code PIN ne change pas.` },
    );
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json({ email, ...result.body });
  });

  router.post("/email/verify", async (req, res) => {
    const parsed = z.object({ email: emailInput, code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres") }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: plainError(parsed.error) });
      return;
    }
    const { email, code } = parsed.data;
    const checked = await verifyOtp(prisma, { secret: config.secret, devCodes: config.devCodes }, emailKey(email), email, code);
    if (!checked.ok) {
      res.status(checked.status).json(checked.body);
      return;
    }
    const driver = await prisma.driver.findUnique({ where: { email } });
    if (!driver) {
      res.status(400).json({ error: "Code expiré. Demandez-en un nouveau." });
      return;
    }
    await prisma.driver.update({ where: { id: driver.id }, data: { pinAttempts: 0, pinLockedUntil: null, pinResetUntil: new Date(Date.now() + PIN_RESET_WINDOW_MS) } });
    open(res, driver);
  });

  zedSignupRoutes(router, prisma, config);

  // Toutes les routes suivantes exigent un livreur validé et actif ; chaque appel vaut signe de vie.
  router.use(requireDriver(config.secret), async (req, res, next) => {
    const driver = await prisma.driver.findUnique({ where: { id: res.locals.driverId }, select: { status: true, active: true, sessionsValidFrom: true } });
    if (!driver || driver.status !== "APPROVED" || !driver.active) {
      res.status(401).json({ error: "Compte livreur suspendu. Appelez la répartition." });
      return;
    }
    if (revokedLongToken(req, config.secret, driver.sessionsValidFrom)) {
      res.status(401).json({ error: "Session expirée, reconnectez-vous" });
      return;
    }
    await prisma.driver.update({ where: { id: res.locals.driverId }, data: { lastSeenAt: new Date() } });
    next();
  });

  pushRoutes(router, prisma, notifier, "driver", (res) => res.locals.driverId, "/livreur");

  // Itinéraire de l'écran « Naviguer » (course, course Zed, mission) : de la position du livreur au point d'arrivée.
  router.get("/route", async (req, res) => {
    const from = parsePoint(req.query.from);
    const to = parsePoint(req.query.to);
    if (!from || !to) {
      res.status(400).json({ error: "Points de départ et d'arrivée invalides" });
      return;
    }
    if (kmBetween(from, to) > MAX_ROUTE_KM) {
      res.status(400).json({ error: "Arrivée trop éloignée pour un itinéraire" });
      return;
    }
    try {
      const route = await fetchRoute(from, to, { baseUrl: config.routingUrl, fetcher: config.routeFetcher, timeoutMs: config.routeTimeoutMs });
      if (!route) {
        res.status(404).json({ error: "Aucun itinéraire trouvé" });
        return;
      }
      res.set("Cache-Control", "private, max-age=60").json(route);
    } catch {
      res.status(503).json({ error: "Itinéraire indisponible pour le moment" });
    }
  });
  zedDriverRoutes(router, prisma, config);
  driverKitRoutes(router, prisma, config);
  serviceProviderRoutes(router, prisma, notifier);

  // Choisir ou changer son PIN : l'ancien est demandé, sauf juste après un code SMS vérifié.
  router.put("/me/pin", async (req, res) => {
    const parsed = z.object({ pin: newPinInput, currentPin: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { pinHash: true, pinResetUntil: true } });
    const fresh = driver.pinResetUntil && driver.pinResetUntil.getTime() > Date.now();
    if (driver.pinHash && !fresh) {
      if (!parsed.data.currentPin || !(await checkPin(parsed.data.currentPin, driver.pinHash))) {
        res.status(400).json({ error: "Code PIN actuel incorrect" });
        return;
      }
    }
    // Nouveau PIN : les autres appareils connectés sont déconnectés, celui-ci reçoit un nouveau jeton.
    const now = Date.now();
    await prisma.driver.update({
      where: { id: driverId },
      data: { pinHash: await hashPin(parsed.data.pin), pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null, sessionsValidFrom: new Date(now) },
    });
    res.json({ ok: true, hasPin: true, token: issueToken(config.secret, now, "driver", driverId, CUSTOMER_TOKEN_TTL_MS) });
  });

  // Téléphone perdu : tous les jetons du livreur cessent de marcher, et les alertes ne partent plus vers ses appareils.
  router.post("/sessions/logout-all", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    await prisma.driver.update({ where: { id: driverId }, data: { sessionsValidFrom: new Date(), online: false } });
    await prisma.pushSubscription.deleteMany({ where: { role: "driver", subject: driverId } });
    res.status(204).end();
  });

  // Supprimer son compte depuis l'application (exigé par Google Play et l'App Store) : mêmes règles que la
  // suppression depuis l'admin (deleteDriverAccount).
  router.delete("/me", async (_req, res) => {
    const result = await deleteDriverAccount(prisma, config.files, res.locals.driverId as string, "self");
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(204).end();
  });

  router.get("/me", async (_req, res) => {
    const driver = await prisma.driver.findUniqueOrThrow({
      where: { id: res.locals.driverId },
      select: { name: true, phone: true, email: true, vehicle: true, employment: true, monthlySalary: true, online: true, createdAt: true, pinHash: true, zone: { select: { name: true } }, _count: { select: { orders: { where: { status: "DELIVERED" } } } } },
    });
    const { _count, pinHash, ...rest } = driver;
    res.json({ ...rest, hasPin: !!pinHash, delivered: _count.orders, dispatchPhone: config.dispatchPhone });
  });

  router.patch("/online", async (req, res) => {
    const parsed = z.object({ online: z.boolean(), motorbikeId: z.string().max(60).optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    try {
      const me = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { employment: true, vehicle: true } });
      if (parsed.data.online && me.employment === "STAFF") {
        // Salarié : il commence son service avec une moto du parc (celle qu'il choisit, ou celle qu'il a déjà).
        const held = await prisma.motorbike.findUnique({ where: { driverId }, select: { id: true } });
        if (parsed.data.motorbikeId && parsed.data.motorbikeId !== held?.id) await assignMotorbike(prisma, parsed.data.motorbikeId, driverId, null);
        else if (!held && (await needsMotorbike(prisma, me))) {
          res.status(409).json({ error: "Choisissez la moto du parc avec laquelle vous travaillez", needsMotorbike: true });
          return;
        }
      }
      const d = await prisma.driver.update({ where: { id: driverId }, data: { online: parsed.data.online }, select: { online: true } });
      // Fin de service : la moto du parc est rendue (gardée tant qu'une course est en cours).
      if (!parsed.data.online && me.employment === "STAFF") await releaseAtEndOfShift(prisma, driverId);
      res.json(d);
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }
  });

  // État courant : courses proposées (à accepter) et courses acceptées en cours. Interrogé toutes les 10 s.
  router.get("/current", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    await expireAssignments(prisma, notifier);
    const now = new Date();
    const [driver, offers, mine, awaiting, zed, docs, bike, slotSeconds] = await Promise.all([
      prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { online: true, deliveries: true, zedStatus: true, zedAvailable: true, employment: true, serviceCodes: true } }),
      prisma.driverAssignment.findMany({ where: { driverId, status: "SENT" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, order: { select: orderSelect } } }),
      prisma.order.findMany({
        // Remise déclarée : la course attend le client, le livreur est libre pour la suivante.
        where: { driverId, status: { in: OPEN }, handedOverAt: null, assignments: { some: { driverId, status: "ACCEPTED" } } },
        orderBy: { createdAt: "asc" },
        select: { ...orderSelect, slotReminderAt: true, slotConfirmedAt: true },
      }),
      // Remises déclarées, en attente de la confirmation du client.
      prisma.order.findMany({ where: { driverId, status: "PICKED_UP", handedOverAt: { not: null } }, orderBy: { handedOverAt: "asc" }, select: orderSelect }),
      zedCurrent(prisma, notifier, driverId),
      // Pièces manquantes (bandeau de l'accueil) et moto du parc prise par un salarié.
      Promise.resolve()
        .then(() => prisma.zedDocument.findMany({ where: { driverId }, select: { kind: true, expiresAt: true } }))
        .catch(() => null),
      Promise.resolve()
        .then(() => prisma.motorbike.findUnique({ where: { driverId }, select: { plate: true, label: true } }))
        .catch(() => null),
      slotOfferSeconds(prisma),
    ]);
    // Retraits réservés dont l'heure est encore loin (plus de 30 min) : à part, ils n'occupent pas le livreur.
    const later = (o: (typeof mine)[number]) => o.status !== "PICKED_UP" && !!o.pickupAt && o.pickupAt.getTime() - now.getTime() > PICKUP_LEAD_MS;
    const active = mine.filter((o) => !later(o));
    const scheduled = mine.filter(later).sort((a, b) => a.pickupAt!.getTime() - b.pickupAt!.getTime());
    // Missions de service (courses, gaz, lessive…) : seulement pour qui a un service dans son profil.
    const missions = await missionsSummary(prisma, driverId, driver.serviceCodes);
    const emp = driver.employment === "STAFF" ? ("STAFF" as const) : ("FREELANCE" as const);
    res.json({
      deliveries: driver.deliveries,
      missions,
      zed: { status: driver.zedStatus, canApply: !driver.zedStatus && driver.employment === "FREELANCE", available: driver.zedAvailable, offer: zed.offer, ride: zed.ride, planEndsAt: zed.planEndsAt, today: zed.today },
      awaiting: awaiting.map((o) => withCash(o, emp)),
      online: driver.online,
      missingDocuments: docs ? missingDocuments(docs) : [],
      motorbike: bike,
      serverTime: new Date().toISOString(),
      offers: offers.map((a) => ({
        id: a.id,
        expiresAt: new Date(a.createdAt.getTime() + offerTimeoutMs(a.order.pickupAt, a.createdAt, slotSeconds)).toISOString(),
        // Réservation d'un retrait programmé : le livreur reste libre jusqu'à l'heure.
        slot: isSlotOffer(a.order.pickupAt, a.createdAt),
        order: withCash(a.order, emp),
      })),
      active: active.map((o) => withCash(o, emp)),
      scheduled: scheduled.map((o) => ({ ...withCash(o, emp), releasableUntil: new Date(o.pickupAt!.getTime() - 60 * 60_000).toISOString() })),
    });
  });

  async function ownAssignment(id: string, driverId: string) {
    const a = await prisma.driverAssignment.findUnique({ where: { id }, include: { order: { select: { id: true, code: true, driverId: true, status: true, pickupAt: true } }, driver: { select: { name: true } } } });
    if (!a || a.driverId !== driverId) throw new HttpError(404, "Course introuvable");
    if (a.status !== "SENT") throw new HttpError(409, a.status === "EXPIRED" ? "Délai dépassé : la course a été retirée" : "Cette course ne vous est plus proposée");
    return a;
  }

  router.post("/assignments/:id/accept", async (req, res) => {
    try {
      const a = await ownAssignment(req.params.id, res.locals.driverId);
      const now = new Date();
      const pickupAt = a.order.pickupAt;
      const slot = isSlotOffer(pickupAt, a.createdAt);
      if (now.getTime() - a.createdAt.getTime() > offerTimeoutMs(pickupAt, a.createdAt, slot ? await slotOfferSeconds(prisma) : undefined)) {
        await expireAssignments(prisma, notifier);
        throw new HttpError(409, "Délai dépassé : la course a été retirée");
      }
      // Réservation : pas deux retraits réservés à moins d'1 h d'écart (une affectation à la main peut le proposer).
      if (slot) {
        const clash = await prisma.order.count({
          where: {
            id: { not: a.orderId },
            driverId: a.driverId,
            status: { in: OPEN },
            handedOverAt: null,
            pickupAt: { gt: new Date(pickupAt!.getTime() - SLOT_GAP_MS), lt: new Date(pickupAt!.getTime() + SLOT_GAP_MS) },
          },
        });
        if (clash) throw new HttpError(409, "Vous avez déjà un retrait réservé à moins d'une heure de celui-ci");
      }
      // Écrite seulement si la proposition est toujours en attente : retirée par la répartition ou expirée entre-temps,
      // elle ne redevient pas « acceptée » (sinon le livreur garderait l'accès à la course d'un autre).
      if (!(await answerAssignment(prisma, a.id, { status: "ACCEPTED", respondedAt: now }))) throw new HttpError(409, "Cette course ne vous est plus proposée");
      if (slot) {
        await onSlotReserved(prisma, notifier, a.orderId, a.driverId, now);
        void notifier.staff("DRIVERS", { title: `Retrait réservé : ${a.order.code}`, body: `${a.driver.name} fera le retrait de ${hhmm(pickupAt!)}.`, url: `/admin/commandes/${a.orderId}`, tag: `assign-${a.orderId}` });
      } else {
        void notifier.staff("DRIVERS", { title: `Course acceptée : ${a.order.code}`, body: `${a.driver.name} est en route.`, url: `/admin/commandes/${a.orderId}`, tag: `assign-${a.orderId}` });
      }
      res.json({ orderId: a.orderId, slot });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/assignments/:id/reject", async (req, res) => {
    const parsed = z.object({ reason: z.string().trim().min(3, "Indiquez la raison du refus").max(200) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const a = await ownAssignment(req.params.id, res.locals.driverId);
      if (!(await answerAssignment(prisma, a.id, { status: "REJECTED", reason: parsed.data.reason, respondedAt: new Date() }))) throw new HttpError(409, "Cette course ne vous est plus proposée");
      await prisma.order.updateMany({ where: { id: a.orderId, driverId: a.driverId }, data: { driverId: null } });
      await notifier.staff("DRIVERS", { title: `Course refusée : ${a.order.code}`, body: `${a.driver.name} : ${parsed.data.reason}`, url: "/admin/dispatch", tag: `assign-${a.orderId}`, alarm: true });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  // Retrait réservé : « Je confirme » (rappel 45 min avant) et désistement (jusqu'à 1 h avant).
  router.post("/orders/:id/slot/confirm", async (req, res) => {
    try {
      if (!(await confirmSlot(prisma, String(req.params.id), res.locals.driverId))) throw new HttpError(404, "Course introuvable");
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/orders/:id/slot/release", async (req, res) => {
    try {
      const r = await releaseSlot(prisma, notifier, String(req.params.id), res.locals.driverId);
      if (r === "NOT_FOUND") throw new HttpError(404, "Course introuvable");
      if (r === "TOO_LATE") throw new HttpError(409, "Moins d'une heure avant le retrait : signalez-le avec « Un problème ? », l'équipe s'en occupe");
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  async function ownOrder(id: string, driverId: string) {
    const order = await prisma.order.findFirst({ where: { id, assignments: { some: { driverId, status: "ACCEPTED" } } }, select: { ...orderSelect, driverId: true } });
    if (!order) throw new HttpError(404, "Course introuvable");
    return order;
  }

  router.get("/orders/:id", async (req, res) => {
    try {
      const order = await ownOrder(req.params.id, res.locals.driverId);
      res.json({ ...withCash(order, await employmentOf(prisma, res.locals.driverId)), mine: order.driverId === res.locals.driverId });
    } catch (e) {
      sendError(res, e);
    }
  });

  // Étapes validées par le livreur. Idempotent : une étape rejouée depuis la file hors connexion ne fait rien.
  router.post("/orders/:id/status", async (req, res) => {
    const parsed = statusInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const driverId: string = res.locals.driverId;
      const data = parsed.data;
      const view = await ownOrder(req.params.id, driverId);
      if (view.driverId !== driverId) throw new HttpError(409, "La répartition a confié cette course à un autre livreur");
      const handedOver = data.status === "DELIVERED" && !!view.handedOverAt;
      if (view.status === data.status || (data.status === "PICKED_UP" && view.status === "DELIVERED") || (handedOver && !data.code)) {
        res.json(withCash(view, await employmentOf(prisma, driverId)));
        return;
      }
      if (view.status === "CANCELLED") throw new HttpError(409, "Commande annulée");
      if (!canDriverMove(view.type, view.status, data.status)) {
        throw new HttpError(409, view.type === "FOOD" && view.status === "PENDING" ? "Le restaurant n'a pas encore accepté la commande" : "Étape impossible pour cette commande");
      }
      const current = await prisma.order.findUniqueOrThrow({ where: { id: view.id } });
      const at = eventTime(data.at);
      const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
      const who = driver?.name ?? "Le livreur";
      if (data.status === "PICKED_UP") {
        const update = await statusUpdate(prisma, current, "PICKED_UP");
        update.pickedUpAt = at;
        // Écrite seulement si la commande n'a pas changé entre-temps (annulée, déjà récupérée).
        const { count } = await prisma.order.updateMany({ where: { id: view.id, status: current.status }, data: update as never });
        if (!count) throw new HttpError(409, "La commande vient de changer : rechargez la course");
        const picked = await prisma.order.findUniqueOrThrow({ where: { id: view.id } });
        notifyCustomer(notifier, picked, "PICKED_UP");
        void notifier.staff("DRIVERS", { title: `Récupérée : ${view.code}`, body: `${who} a récupéré la commande.`, url: `/admin/commandes/${view.id}`, tag: `step-${view.id}` });
      } else {
        // Espèces : déclarées à la remise, une seule fois.
        const cash: { cashCollected?: number; cashNote?: string | null } = {};
        if (!handedOver) {
          const due = cashDue(current);
          const problem = checkCash(due, data.cashCollected, data.cashNote);
          if (problem) throw new HttpError(400, problem);
          if (due) Object.assign(cash, { cashCollected: data.cashCollected, cashNote: data.cashCollected !== due ? data.cashNote : null });
        }
        if (data.code && !codeMatches(current.deliveryCode, data.code)) throw new HttpError(400, "Code incorrect : demandez au client le code affiché dans son suivi");
        const handedOverAt = current.handedOverAt ?? at;
        // Écrite seulement si la commande est toujours en route (pas annulée ni clôturée entre-temps).
        const { count } = await prisma.order.updateMany({ where: { id: view.id, status: "PICKED_UP" }, data: { ...cash, handedOverAt, pickedUpAt: current.pickedUpAt ?? at } });
        if (!count) throw new HttpError(409, "La commande vient de changer : rechargez la course");
        const after = await prisma.order.findUniqueOrThrow({ where: { id: view.id } });
        // Bon code, ou ancienne commande sans code : clôturée tout de suite. Sinon le client confirme.
        const closing = !!data.code || !current.deliveryCode;
        if (closing) await closeDelivery(prisma, notifier, after, data.code ? "CODE" : "DRIVER");
        else if (!handedOver) notifyCustomer(notifier, after, "HANDED_OVER");
        if (!handedOver) {
          void notifier.staff("DRIVERS", {
            title: `${closing ? "Livrée" : "Remise"} : ${view.code}`,
            body: closing ? `${who} a livré la commande.` : `${who} a remis la commande, en attente de la confirmation du client.`,
            url: `/admin/commandes/${view.id}`,
            tag: `step-${view.id}`,
          });
        }
        if (cash.cashNote) {
          await notifier.staff("FINANCE", {
            title: `Écart d'espèces : ${view.code}`,
            body: `Reçu ${formatFcfa(data.cashCollected ?? 0)} au lieu de ${formatFcfa(view.total)} : ${cash.cashNote}`,
            url: `/admin/commandes/${view.id}`,
            tag: `cash-${view.id}`,
          });
        }
      }
      res.json(withCash(await prisma.order.findUniqueOrThrow({ where: { id: view.id }, select: orderSelect }), await employmentOf(prisma, driverId)));
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/location", async (req, res) => {
    const parsed = locationInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    const { latitude, longitude, accuracy, orderId } = parsed.data;
    const order = orderId ? await prisma.order.findFirst({ where: { id: orderId, driverId }, select: { id: true } }) : null;
    const now = new Date();
    await prisma.$transaction([
      prisma.driverLocation.create({ data: { driverId, orderId: order?.id ?? null, latitude, longitude, accuracy: accuracy ?? null } }),
      prisma.driver.update({ where: { id: driverId }, data: { lastLatitude: latitude, lastLongitude: longitude, lastLocationAt: now, lastSeenAt: now } }),
    ]);
    res.status(201).json({ ok: true });
  });

  router.post("/issues", async (req, res) => {
    const parsed = issueInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    const { orderId, kind, note, latitude, longitude } = parsed.data;
    const order = orderId ? await prisma.order.findFirst({ where: { id: orderId, driverId }, select: { id: true, code: true } }) : null;
    const issue = await prisma.driverIssue.create({ data: { driverId, orderId: order?.id ?? null, kind, note: note || null, latitude: latitude ?? null, longitude: longitude ?? null } });
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { name: true } });
    await notifier.staff("DRIVERS", {
      title: `Problème signalé${order ? ` : ${order.code}` : ""}`,
      body: `${driver.name} · ${ISSUE_KINDS[kind]}${note ? ` · ${note}` : ""}`,
      url: "/admin/dispatch",
      tag: `issue-${issue.id}`,
      alarm: true,
    });
    res.status(201).json({ id: issue.id });
  });

  // Espèces encaissées et pas encore remises à Zedeka.
  router.get("/cash", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    const [orders, handovers] = await Promise.all([
      prisma.order.findMany({
        where: { driverId, status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null },
        orderBy: { deliveredAt: "desc" },
        select: { id: true, code: true, total: true, cashCollected: true, cashNote: true, deliveredAt: true },
      }),
      prisma.cashCollection.findMany({ where: { driverId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, amount: true, createdAt: true, _count: { select: { orders: true } } } }),
    ]);
    const list = orders.map((o) => ({ ...o, amount: o.cashCollected ?? o.total }));
    res.json({
      total: list.reduce((s, o) => s + o.amount, 0),
      orders: list,
      handovers: handovers.map(({ _count, ...h }) => ({ ...h, orders: _count.orders })),
    });
  });

  router.get("/earnings", async (_req, res) => {
    const since = new Date(Date.now() - 62 * 24 * 60 * 60_000);
    const orders = await prisma.order.findMany({
      where: { driverId: res.locals.driverId, status: "DELIVERED", deliveredAt: { gte: since } },
      orderBy: { deliveredAt: "desc" },
      select: { id: true, code: true, type: true, driverEarning: true, deliveredAt: true, zone: { select: { name: true } } },
    });
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: res.locals.driverId }, select: { employment: true, monthlySalary: true } });
    res.json({ ...earningsSummary(orders), ...driver, recent: orders.slice(0, 30) });
  });

  // Accueil du livreur : note, compteurs du jour (courses, gains, espèces en main) et courses terminées aujourd'hui.
  router.get("/today", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    const start = startOfLomeDay(new Date());
    const [rated, done, cash, rides] = await Promise.all([
      prisma.order.aggregate({ where: { driverId, driverRating: { not: null } }, _avg: { driverRating: true } }),
      prisma.order.findMany({
        where: { driverId, status: "DELIVERED", deliveredAt: { gte: start } },
        orderBy: { deliveredAt: "desc" },
        select: { id: true, code: true, type: true, driverEarning: true, deliveredAt: true, address: true, restaurant: { select: { name: true } } },
      }),
      prisma.order.findMany({ where: { driverId, status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null }, select: { total: true, cashCollected: true } }),
      // Courses Zed terminées : celles du jour pour les compteurs, les dernières pour la liste.
      prisma.zedRide.findMany({
        where: { driverId, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 30,
        select: { id: true, code: true, landmark: true, destination: true, completedAt: true, price: true, rating: true },
      }),
    ]);
    const zedToday = rides.filter((r) => r.completedAt && r.completedAt >= start);
    const zedRated = rides.filter((r) => r.rating !== null);
    res.json({
      rating: rated._avg.driverRating ? Math.round(rated._avg.driverRating * 10) / 10 : null,
      count: done.length,
      earnings: done.reduce((s, o) => s + o.driverEarning, 0),
      cash: cash.reduce((s, o) => s + (o.cashCollected ?? o.total), 0),
      done,
      zed: {
        count: zedToday.length,
        prices: zedToday.reduce((s, r) => s + (r.price ?? 0), 0),
        rating: zedRated.length ? Math.round((zedRated.reduce((s, r) => s + (r.rating ?? 0), 0) / zedRated.length) * 10) / 10 : null,
        recent: rides.slice(0, 5),
      },
    });
  });

  router.get("/history", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    res.json(
      await prisma.order.findMany({
        where: { driverId, status: { in: ["DELIVERED", "CANCELLED"] } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, code: true, type: true, status: true, total: true, driverEarning: true, address: true, deliveredAt: true, cancelledAt: true, restaurant: { select: { name: true } } },
      }),
    );
  });

  return router;
}

function sendError(res: import("express").Response, e: unknown) {
  if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
  else throw e;
}

// Début de la journée à Lomé (UTC, sans heure d'été).
function startOfLomeDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
