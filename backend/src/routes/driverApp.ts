import { type Response, Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CUSTOMER_TOKEN_TTL_MS, issueToken, requireDriver, revokedLongToken } from "../auth.js";
import { normalizePhone, phoneTail } from "../customer.js";
import { ASSIGNMENT_TIMEOUT_MS, canDriverMove, cashDue, checkCash, earningsSummary, eventTime, ISSUE_KINDS, OFFLINE_AFTER_MS } from "../driver.js";
import type { Notifier } from "../notify.js";
import { OPEN, statusUpdate } from "../orderFlow.js";
import { alertLowDeposit } from "../deposit.js";
import { formatFcfa } from "../pricing.js";
import { closeDelivery, codeMatches } from "../receipt.js";
import { HttpError } from "./adminWrite.js";
import { requestEmailOtp, requestOtp, verifyOtp, type PhoneVerifier } from "../otp.js";
import { checkPin, hashPin, newPinInput, PIN_LOCK_MS, PIN_MAX_ATTEMPTS, PIN_RESET_WINDOW_MS } from "../pin.js";
import { pushRoutes } from "./partnerAccount.js";
import type { EmailSender } from "../email.js";
import { langOf } from "../i18n.js";
import { emailInput, firstError } from "../util.js";

// Application livreur (/api/livreur) : connexion par numéro et code PIN (code SMS pour le PIN oublié), courses proposées par la répartition,
// étapes de livraison, espèces, gains, position et signalement de problème.

type Config = { secret: string; notifier: Notifier; devCodes: boolean; verifier?: PhoneVerifier; dispatchPhone: string; email?: EmailSender };

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
const otpKey = (phone: string) => `driver:${phone}`;
const emailKey = (email: string) => `driver:email:${email}`;

// Livreur dont le numéro (enregistré tel quel à la candidature) finit par les mêmes 8 chiffres.
async function driverByPhone(prisma: PrismaClient, phone: string) {
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
  zone: { select: { name: true } },
  restaurant: { select: { name: true, phone: true, address: true, latitude: true, longitude: true } },
  items: { select: { name: true, variantName: true, quantity: true } },
} satisfies Prisma.OrderSelect;

type DriverOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
const withCash = (o: DriverOrder) => ({ ...o, cashDue: cashDue(o) });

// Courses proposées restées sans réponse : retirées au livreur et signalées à la répartition.
export async function expireAssignments(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const late = await prisma.driverAssignment.findMany({
    where: { status: "SENT", createdAt: { lt: new Date(now.getTime() - ASSIGNMENT_TIMEOUT_MS) } },
    select: { id: true, orderId: true, driverId: true, driver: { select: { name: true } }, order: { select: { code: true } } },
  });
  for (const a of late) {
    const { count } = await prisma.driverAssignment.updateMany({ where: { id: a.id, status: "SENT" }, data: { status: "EXPIRED", respondedAt: now, reason: "Pas de réponse" } });
    if (!count) continue;
    await prisma.order.updateMany({ where: { id: a.orderId, driverId: a.driverId, status: { in: OPEN } }, data: { driverId: null } });
    await notifier.staff("DRIVERS", {
      title: `Course non acceptée : ${a.order.code}`,
      body: `${a.driver.name} n'a pas répondu en 60 s. À réaffecter.`,
      url: "/admin/dispatch",
      tag: `assign-${a.orderId}`,
      alarm: true,
    });
  }
  return late.length;
}

// Livreurs « en ligne » dont l'application ne donne plus signe de vie.
export async function autoOffline(prisma: PrismaClient, now = new Date()) {
  const { count } = await prisma.driver.updateMany({
    where: { online: true, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - OFFLINE_AFTER_MS) } }] },
    data: { online: false },
  });
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
) {
  if (order.driverId === driverId) return;
  await prisma.driverAssignment.updateMany({ where: { orderId: order.id, status: { in: ["SENT", "ACCEPTED"] } }, data: { status: "WITHDRAWN", respondedAt: new Date() } });
  if (!driverId) return;
  // Un salarié de Zedeka ne choisit pas : la course lui est attribuée d'office, sans délai de réponse.
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { employment: true } });
  if (driver?.employment === "STAFF") {
    const now = new Date();
    await prisma.driverAssignment.create({ data: { orderId: order.id, driverId, status: "ACCEPTED", respondedAt: now, assignedBy } });
    await notifier.push("driver", driverId, { title: `Course attribuée : ${order.code}`, body: "Le dispatch vous a attribué une course. Ouvrez l'application.", url: "/livreur", tag: `offer-${order.id}`, alarm: true });
    return;
  }
  await prisma.driverAssignment.create({ data: { orderId: order.id, driverId, assignedBy } });
  await notifier.push("driver", driverId, { title: `Nouvelle course ${order.code}`, body: "Acceptez ou refusez dans les 60 secondes.", url: "/livreur", tag: `offer-${order.id}`, alarm: true });
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
  async function open(res: Response, driver: { id: string; name: string; phone: string; status: string; active: boolean; createdAt: Date; pinHash: string | null }) {
    if (driver.status !== "APPROVED" || !driver.active) {
      const status = driver.status === "APPROVED" ? "SUSPENDED" : driver.status;
      res.json({ application: { name: driver.name, status, createdAt: driver.createdAt } });
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
    if (driver.pinLockedUntil && driver.pinLockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((driver.pinLockedUntil.getTime() - Date.now()) / 60_000);
      res.status(429).json({ error: `Trop d'essais. Réessayez dans ${minutes} min ou choisissez « Code PIN oublié ».` });
      return;
    }
    if (!driver.pinHash) {
      res.status(400).json({ error: "Pas encore de code PIN pour ce compte. Recevez un code par SMS pour le créer, ou demandez-le à la répartition.", noPin: true });
      return;
    }
    if (!(await checkPin(parsed.data.pin, driver.pinHash))) {
      const attempts = driver.pinAttempts + 1;
      const locked = attempts >= PIN_MAX_ATTEMPTS;
      await prisma.driver.update({
        where: { id: driver.id },
        data: locked ? { pinAttempts: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MS) } : { pinAttempts: attempts },
      });
      res.status(locked ? 429 : 400).json({ error: locked ? "Trop d'essais. Réessayez dans 15 min ou choisissez « Code PIN oublié »." : wrong });
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
    await prisma.driver.update({
      where: { id: driverId },
      data: { pinHash: await hashPin(parsed.data.pin), pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null },
    });
    res.json({ ok: true, hasPin: true });
  });

  // Téléphone perdu : tous les jetons du livreur cessent de marcher, et les alertes ne partent plus vers ses appareils.
  router.post("/sessions/logout-all", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    await prisma.driver.update({ where: { id: driverId }, data: { sessionsValidFrom: new Date(), online: false } });
    await prisma.pushSubscription.deleteMany({ where: { role: "driver", subject: driverId } });
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
    const parsed = z.object({ online: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const d = await prisma.driver.update({ where: { id: res.locals.driverId }, data: { online: parsed.data.online }, select: { online: true } });
    res.json(d);
  });

  // État courant : courses proposées (à accepter) et courses acceptées en cours. Interrogé toutes les 10 s.
  router.get("/current", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    await expireAssignments(prisma, notifier);
    const [driver, offers, active, awaiting] = await Promise.all([
      prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { online: true } }),
      prisma.driverAssignment.findMany({ where: { driverId, status: "SENT" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, order: { select: orderSelect } } }),
      prisma.order.findMany({
        // Remise déclarée : la course attend le client, le livreur est libre pour la suivante.
        where: { driverId, status: { in: OPEN }, handedOverAt: null, assignments: { some: { driverId, status: "ACCEPTED" } } },
        orderBy: { createdAt: "asc" },
        select: orderSelect,
      }),
      // Remises déclarées, en attente de la confirmation du client.
      prisma.order.findMany({ where: { driverId, status: "PICKED_UP", handedOverAt: { not: null } }, orderBy: { handedOverAt: "asc" }, select: orderSelect }),
    ]);
    res.json({
      awaiting: awaiting.map(withCash),
      online: driver.online,
      serverTime: new Date().toISOString(),
      offers: offers.map((a) => ({ id: a.id, expiresAt: new Date(a.createdAt.getTime() + ASSIGNMENT_TIMEOUT_MS).toISOString(), order: withCash(a.order) })),
      active: active.map(withCash),
    });
  });

  async function ownAssignment(id: string, driverId: string) {
    const a = await prisma.driverAssignment.findUnique({ where: { id }, include: { order: { select: { id: true, code: true, driverId: true, status: true } }, driver: { select: { name: true } } } });
    if (!a || a.driverId !== driverId) throw new HttpError(404, "Course introuvable");
    if (a.status !== "SENT") throw new HttpError(409, a.status === "EXPIRED" ? "Délai dépassé : la course a été retirée" : "Cette course ne vous est plus proposée");
    return a;
  }

  router.post("/assignments/:id/accept", async (req, res) => {
    try {
      const a = await ownAssignment(req.params.id, res.locals.driverId);
      if (Date.now() - a.createdAt.getTime() > ASSIGNMENT_TIMEOUT_MS) {
        await expireAssignments(prisma, notifier);
        throw new HttpError(409, "Délai dépassé : la course a été retirée");
      }
      await prisma.driverAssignment.update({ where: { id: a.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
      void notifier.staff("DRIVERS", { title: `Course acceptée : ${a.order.code}`, body: `${a.driver.name} est en route.`, url: `/admin/commandes/${a.orderId}`, tag: `assign-${a.orderId}` });
      res.json({ orderId: a.orderId });
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
      await prisma.driverAssignment.update({ where: { id: a.id }, data: { status: "REJECTED", reason: parsed.data.reason, respondedAt: new Date() } });
      await prisma.order.updateMany({ where: { id: a.orderId, driverId: a.driverId }, data: { driverId: null } });
      await notifier.staff("DRIVERS", { title: `Course refusée : ${a.order.code}`, body: `${a.driver.name} : ${parsed.data.reason}`, url: "/admin/dispatch", tag: `assign-${a.orderId}`, alarm: true });
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
      res.json({ ...withCash(order), mine: order.driverId === res.locals.driverId });
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
        res.json(withCash(view));
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
        await prisma.order.update({ where: { id: view.id }, data: update });
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
        const after = await prisma.order.update({ where: { id: view.id }, data: { ...cash, handedOverAt, pickedUpAt: current.pickedUpAt ?? at } });
        // Bon code, ou ancienne commande sans code : clôturée tout de suite. Sinon le client confirme.
        const closing = !!data.code || !current.deliveryCode;
        if (closing) await closeDelivery(prisma, notifier, after, data.code ? "CODE" : "DRIVER");
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
      res.json(withCash(await prisma.order.findUniqueOrThrow({ where: { id: view.id }, select: orderSelect })));
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
