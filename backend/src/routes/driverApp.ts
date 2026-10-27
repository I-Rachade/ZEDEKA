import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CUSTOMER_TOKEN_TTL_MS, issueToken, requireDriver } from "../auth.js";
import { hashOtp, newOtpCode, normalizePhone, OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, OTP_RESEND_DELAY_MS, OTP_TTL_MS, phoneTail } from "../customer.js";
import { ASSIGNMENT_TIMEOUT_MS, canDriverMove, cashDue, checkCash, earningsSummary, eventTime, ISSUE_KINDS, OFFLINE_AFTER_MS } from "../driver.js";
import type { Notifier } from "../notify.js";
import { OPEN, statusUpdate } from "../orderFlow.js";
import { formatFcfa } from "../pricing.js";
import { HttpError } from "./adminWrite.js";
import type { OtpSender } from "./customer.js";
import { pushRoutes } from "./partnerAccount.js";
import { firstError } from "../util.js";

// Application livreur (/api/livreur) : connexion par code SMS, courses proposées par la répartition,
// étapes de livraison, espèces, gains, position et signalement de problème.

type Config = { secret: string; notifier: Notifier; devCodes: boolean; sendOtp?: OtpSender; dispatchPhone: string };

const phoneInput = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numéro togolais invalide (8 chiffres)" });
    return z.NEVER;
  }
  return phone;
});

// Les codes livreur sont rangés à part de ceux des clients (même table, clé préfixée).
const otpKey = (phone: string) => `driver:${phone}`;

// Livreur dont le numéro (enregistré tel quel à la candidature) finit par les mêmes 8 chiffres.
async function driverByPhone(prisma: PrismaClient, phone: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Driver" WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = ${phoneTail(phone)} LIMIT 1`;
  return rows[0] ? prisma.driver.findUnique({ where: { id: rows[0].id } }) : null;
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
  note: true,
  pickupAddress: true,
  recipientName: true,
  recipientPhone: true,
  weightKg: true,
  parcelSize: true,
  parcelCategory: { select: { name: true } },
  paymentMethod: true,
  paymentStatus: true,
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
    await notifier.push("admin", "admin", {
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
export async function assignDriver(prisma: PrismaClient, notifier: Notifier, order: { id: string; code: string; driverId: string | null }, driverId: string | null) {
  if (order.driverId === driverId) return;
  await prisma.driverAssignment.updateMany({ where: { orderId: order.id, status: { in: ["SENT", "ACCEPTED"] } }, data: { status: "WITHDRAWN", respondedAt: new Date() } });
  if (!driverId) return;
  await prisma.driverAssignment.create({ data: { orderId: order.id, driverId } });
  await notifier.push("driver", driverId, { title: `Nouvelle course ${order.code}`, body: "Acceptez ou refusez dans les 60 secondes.", url: "/livreur", tag: `offer-${order.id}`, alarm: true });
}

const statusInput = z.object({
  status: z.enum(["PICKED_UP", "DELIVERED"]),
  at: z.string().max(40).optional(),
  cashCollected: z.number().int().min(0).max(10_000_000).optional(),
  cashNote: z.string().trim().max(300).optional(),
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
    const key = otpKey(phone);
    const now = Date.now();
    const recent = await prisma.otpCode.findMany({ where: { phone: key, createdAt: { gte: new Date(now - 60 * 60 * 1000) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const last = recent[0]?.createdAt.getTime();
    if (last && now - last < OTP_RESEND_DELAY_MS) {
      const wait = Math.ceil((OTP_RESEND_DELAY_MS - (now - last)) / 1000);
      res.status(429).json({ error: `Patientez ${wait} s avant de demander un nouveau code`, retryIn: wait });
      return;
    }
    if (recent.length >= OTP_MAX_PER_HOUR) {
      res.status(429).json({ error: "Trop de codes demandés. Réessayez dans une heure." });
      return;
    }
    if (!config.sendOtp && !config.devCodes) {
      res.status(503).json({ error: "L'envoi des codes n'est pas encore disponible. Appelez la répartition." });
      return;
    }
    const code = newOtpCode();
    await prisma.otpCode.create({ data: { phone: key, codeHash: hashOtp(key, code, config.secret), expiresAt: new Date(now + OTP_TTL_MS) } });
    if (config.sendOtp) await config.sendOtp(phone, code);
    res.json({ phone, expiresInMinutes: OTP_TTL_MS / 60_000, ...(config.devCodes && !config.sendOtp ? { devCode: code } : {}) });
  });

  router.post("/otp/verify", async (req, res) => {
    const parsed = z.object({ phone: phoneInput, code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres") }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone, code } = parsed.data;
    const key = otpKey(phone);
    const otp = await prisma.otpCode.findFirst({ where: { phone: key, consumedAt: null }, orderBy: { createdAt: "desc" } });
    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "Code expiré. Demandez-en un nouveau." });
      return;
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Trop d'essais. Demandez un nouveau code." });
      return;
    }
    if (otp.codeHash !== hashOtp(key, code, config.secret)) {
      const { attempts } = await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const left = OTP_MAX_ATTEMPTS - attempts;
      res.status(400).json({ error: left > 0 ? `Code incorrect. Encore ${left} essai${left > 1 ? "s" : ""}.` : "Trop d'essais. Demandez un nouveau code." });
      return;
    }
    await prisma.otpCode.updateMany({ where: { phone: key, consumedAt: null }, data: { consumedAt: new Date() } });
    const driver = await driverByPhone(prisma, phone);
    if (!driver) {
      res.status(404).json({ error: "Aucun livreur n'est inscrit avec ce numéro.", apply: true });
      return;
    }
    // Candidature pas encore validée, refusée ou compte suspendu : on montre où elle en est, sans ouvrir l'application.
    if (driver.status !== "APPROVED" || !driver.active) {
      const status = driver.status === "APPROVED" ? "SUSPENDED" : driver.status;
      res.json({ application: { name: driver.name, status, createdAt: driver.createdAt } });
      return;
    }
    await prisma.driver.update({ where: { id: driver.id }, data: { lastSeenAt: new Date() } });
    res.json({ token: issueToken(config.secret, Date.now(), "driver", driver.id, CUSTOMER_TOKEN_TTL_MS), driver: { name: driver.name, phone: driver.phone } });
  });

  // Toutes les routes suivantes exigent un livreur validé et actif ; chaque appel vaut signe de vie.
  router.use(requireDriver(config.secret), async (_req, res, next) => {
    const driver = await prisma.driver.findUnique({ where: { id: res.locals.driverId }, select: { status: true, active: true } });
    if (!driver || driver.status !== "APPROVED" || !driver.active) {
      res.status(401).json({ error: "Compte livreur suspendu. Appelez la répartition." });
      return;
    }
    await prisma.driver.update({ where: { id: res.locals.driverId }, data: { lastSeenAt: new Date() } });
    next();
  });

  pushRoutes(router, prisma, notifier, "driver", (res) => res.locals.driverId, "/livreur");

  router.get("/me", async (_req, res) => {
    const driver = await prisma.driver.findUniqueOrThrow({
      where: { id: res.locals.driverId },
      select: { name: true, phone: true, vehicle: true, online: true, createdAt: true, zone: { select: { name: true } }, _count: { select: { orders: { where: { status: "DELIVERED" } } } } },
    });
    const { _count, ...rest } = driver;
    res.json({ ...rest, delivered: _count.orders, dispatchPhone: config.dispatchPhone });
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
    const [driver, offers, active] = await Promise.all([
      prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { online: true } }),
      prisma.driverAssignment.findMany({ where: { driverId, status: "SENT" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, order: { select: orderSelect } } }),
      prisma.order.findMany({
        where: { driverId, status: { in: OPEN }, assignments: { some: { driverId, status: "ACCEPTED" } } },
        orderBy: { createdAt: "asc" },
        select: orderSelect,
      }),
    ]);
    res.json({
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
      await notifier.push("admin", "admin", { title: `Course refusée : ${a.order.code}`, body: `${a.driver.name} : ${parsed.data.reason}`, url: "/admin/dispatch", tag: `assign-${a.orderId}`, alarm: true });
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
      if (view.status === data.status || (data.status === "PICKED_UP" && view.status === "DELIVERED")) {
        res.json(withCash(view));
        return;
      }
      if (view.status === "CANCELLED") throw new HttpError(409, "Commande annulée");
      if (!canDriverMove(view.type, view.status, data.status)) {
        throw new HttpError(409, view.type === "FOOD" && view.status === "PENDING" ? "Le restaurant n'a pas encore accepté la commande" : "Étape impossible pour cette commande");
      }
      const current = await prisma.order.findUniqueOrThrow({ where: { id: view.id } });
      const update = await statusUpdate(prisma, current, data.status);
      const at = eventTime(data.at);
      if (data.status === "PICKED_UP") update.pickedUpAt = at;
      if (data.status === "DELIVERED") {
        update.deliveredAt = at;
        if (!current.pickedUpAt) update.pickedUpAt = at;
        const due = cashDue(current);
        const problem = checkCash(due, data.cashCollected, data.cashNote);
        if (problem) throw new HttpError(400, problem);
        if (due) Object.assign(update, { cashCollected: data.cashCollected, cashNote: data.cashCollected !== due ? data.cashNote : null });
      }
      await prisma.order.update({ where: { id: view.id }, data: update });
      if (data.status === "DELIVERED" && update.cashNote) {
        await notifier.push("admin", "admin", {
          title: `Écart d'espèces : ${view.code}`,
          body: `Reçu ${formatFcfa(data.cashCollected ?? 0)} au lieu de ${formatFcfa(view.total)} : ${data.cashNote}`,
          url: `/admin/commandes/${view.id}`,
          tag: `cash-${view.id}`,
        });
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
    await notifier.push("admin", "admin", {
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
    res.json({ ...earningsSummary(orders), recent: orders.slice(0, 30) });
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
