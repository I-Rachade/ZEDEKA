import { type Request, type Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { issueToken, tokenIssuedAt } from "../auth.js";
import { hashOtp, newOtpCode } from "../customer.js";
import { isPushService, NATIVE_PREFIX, type Notifier } from "../notify.js";
import { closedUntilFor } from "../partner.js";
import { langOf, sms } from "../i18n.js";
import { firstError } from "../util.js";

// Compte d'un partenaire (restaurant ou loueur) : ouvert/fermé, mot de passe, sessions, notifications.

export type PartnerAccount = {
  id: string;
  name: string;
  phone: string;
  ownerEmail: string | null;
  ownerPasswordHash: string | null;
  sessionsValidFrom: Date | null;
};

export type PartnerStore = {
  byId: (id: string) => Promise<PartnerAccount | null>;
  byEmail: (email: string) => Promise<PartnerAccount | null>;
  update: (id: string, data: { ownerPasswordHash?: string; sessionsValidFrom?: Date; temporarilyClosed?: boolean; closedUntil?: Date | null }) => Promise<unknown>;
};

type Deps = {
  prisma: PrismaClient;
  role: "restaurant";
  secret: string;
  notifier: Notifier;
  devCodes: boolean;
  store: PartnerStore;
  subject: (res: Response) => string;
};

const RESET_TTL_MS = 15 * 60_000;
const RESET_MAX_ATTEMPTS = 5;

export const newPassword = z
  .string()
  .min(8, "8 caractères minimum")
  .max(100)
  .regex(/[a-zA-Z]/, "Au moins une lettre")
  .regex(/\d/, "Au moins un chiffre");

const email = z.string().trim().toLowerCase().email("Adresse e-mail invalide");

// À monter avant l'authentification : mot de passe oublié.
export function partnerPublicRouter(deps: Deps) {
  const { prisma, role, secret, notifier, store } = deps;
  const router = Router();

  router.post("/password/forgot", async (req, res) => {
    const parsed = z.object({ email }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const account = await store.byEmail(parsed.data.email);
    // Même réponse que le compte existe ou non, pour ne pas révéler les adresses inscrites.
    const reply = { ok: true, expiresInMinutes: RESET_TTL_MS / 60_000 };
    if (!account) {
      res.json(reply);
      return;
    }
    const recent = await prisma.passwordReset.count({ where: { role, subject: account.id, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } });
    if (recent >= 5) {
      res.status(429).json({ error: "Trop de demandes. Réessayez dans une heure." });
      return;
    }
    const code = newOtpCode();
    await prisma.passwordReset.create({
      data: { role, subject: account.id, codeHash: hashOtp(`${role}:${account.id}`, code, secret), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    // Envoi par SMS au numéro du compte ; l'e-mail suivra quand un fournisseur sera branché.
    await notifier.sms(account.phone, sms.passwordCode(code, langOf(req)));
    res.json({ ...reply, ...(deps.devCodes ? { devCode: code } : {}) });
  });

  router.post("/password/reset", async (req, res) => {
    const parsed = z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres"), password: newPassword }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const account = await store.byEmail(parsed.data.email);
    const reset = account && (await prisma.passwordReset.findFirst({ where: { role, subject: account.id, consumedAt: null }, orderBy: { createdAt: "desc" } }));
    if (!account || !reset || reset.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "Code expiré. Demandez-en un nouveau." });
      return;
    }
    if (reset.attempts >= RESET_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Trop d'essais. Demandez un nouveau code." });
      return;
    }
    if (reset.codeHash !== hashOtp(`${role}:${account.id}`, parsed.data.code, secret)) {
      await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
      res.status(400).json({ error: "Code incorrect" });
      return;
    }
    await prisma.passwordReset.updateMany({ where: { role, subject: account.id, consumedAt: null }, data: { consumedAt: new Date() } });
    const now = new Date();
    await store.update(account.id, { ownerPasswordHash: await bcrypt.hash(parsed.data.password, 10), sessionsValidFrom: now });
    res.json({ token: issueToken(secret, now.getTime(), role, account.id), name: account.name });
  });

  return router;
}

// Refuse les jetons émis avant « se déconnecter partout » ou un changement de mot de passe.
export function sessionGuard(deps: Pick<Deps, "secret" | "store" | "subject">) {
  return async (req: Request, res: Response, next: () => void) => {
    const account = await deps.store.byId(deps.subject(res));
    const issued = tokenIssuedAt(req, deps.secret);
    if (!account || (account.sessionsValidFrom && (issued ?? 0) < account.sessionsValidFrom.getTime())) {
      res.status(401).json({ error: "Session expirée, reconnectez-vous" });
      return;
    }
    next();
  };
}

// Abonnements Web Push d'un navigateur pour le compte connecté.
export function pushRoutes(router: Router, prisma: PrismaClient, notifier: Notifier, role: string, subject: (res: Response) => string, testUrl: string) {
  const subscription = z.object({
    endpoint: z.string().url().max(1000).refine(isPushService, "Service de notification inconnu"),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  });

  router.get("/push/key", (_req, res) => {
    res.json({ publicKey: notifier.publicKey });
  });

  router.post("/push", async (req, res) => {
    const parsed = subscription.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { endpoint, keys } = parsed.data;
    const data = { role, subject: subject(res), p256dh: keys.p256dh, auth: keys.auth, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200) || null };
    await prisma.pushSubscription.upsert({ where: { endpoint }, update: data, create: { endpoint, ...data } });
    res.status(201).json({ ok: true, devices: await prisma.pushSubscription.count({ where: { role, subject: subject(res) } }) });
  });

  // Application Android ou iOS : jeton Firebase (FCM) à la place d'un abonnement de navigateur.
  router.post("/push/native", async (req, res) => {
    const parsed = z.object({ token: z.string().min(20).max(4096).regex(/^[\w:.-]+$/, "Jeton invalide"), platform: z.enum(["android", "ios"]) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const endpoint = NATIVE_PREFIX + parsed.data.token;
    const data = { role, subject: subject(res), p256dh: "", auth: parsed.data.platform, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200) || null };
    await prisma.pushSubscription.upsert({ where: { endpoint }, update: data, create: { endpoint, ...data } });
    res.status(201).json({ ok: true, devices: await prisma.pushSubscription.count({ where: { role, subject: subject(res) } }) });
  });

  router.delete("/push", async (req, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
    await prisma.pushSubscription.deleteMany({ where: { endpoint, role, subject: subject(res) } });
    res.status(204).end();
  });

  router.get("/push", async (_req, res) => {
    res.json({ devices: await prisma.pushSubscription.count({ where: { role, subject: subject(res) } }) });
  });

  router.post("/push/test", async (_req, res) => {
    const sent = await notifier.push(role, subject(res), { title: "Zedeka", body: "Les notifications fonctionnent sur cet appareil.", url: testUrl, tag: "test" });
    res.json({ sent });
  });
}

// Routes du compte connecté : statut ouvert/fermé, mot de passe, sessions, notifications.
export function partnerPrivateRoutes(router: Router, deps: Deps, panelPath: string) {
  const { prisma, role, secret, notifier, store, subject } = deps;

  router.patch("/status", async (req, res) => {
    const parsed = z.object({ open: z.boolean(), duration: z.enum(["30m", "1h", "tomorrow", "indefinite"]).default("indefinite") }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { open, duration } = parsed.data;
    const id = subject(res);
    const closedUntil = open ? null : closedUntilFor(duration);
    await store.update(id, open ? { temporarilyClosed: false, closedUntil: null } : { temporarilyClosed: true, closedUntil });
    const account = await store.byId(id);
    const until = closedUntil ? ` jusqu'à ${closedUntil.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" })}` : " jusqu'à nouvel ordre";
    void notifier.staff("RESTAURANTS", {
      title: `${account?.name ?? "Restaurant"} ${open ? "rouvert" : "fermé"}`,
      body: open ? "Les clients peuvent de nouveau commander." : `Fermeture temporaire${until}.`,
      url: `/admin/restaurants/${id}`,
      tag: `restaurant-open-${id}`,
    });
    res.json({ ok: true });
  });

  router.post("/password", async (req, res) => {
    const parsed = z.object({ current: z.string().min(1, "Mot de passe actuel requis"), password: newPassword }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const account = await store.byId(subject(res));
    if (!account?.ownerPasswordHash || !(await bcrypt.compare(parsed.data.current, account.ownerPasswordHash))) {
      res.status(400).json({ error: "Mot de passe actuel incorrect" });
      return;
    }
    const now = new Date();
    await store.update(account.id, { ownerPasswordHash: await bcrypt.hash(parsed.data.password, 10), sessionsValidFrom: now });
    // Les autres appareils sont déconnectés ; celui-ci reçoit un nouveau jeton.
    res.json({ token: issueToken(secret, now.getTime(), role, account.id) });
  });

  router.post("/sessions/logout-all", async (_req, res) => {
    await store.update(subject(res), { sessionsValidFrom: new Date() });
    await prisma.pushSubscription.deleteMany({ where: { role, subject: subject(res) } });
    res.status(204).end();
  });

  pushRoutes(router, prisma, notifier, role, subject, panelPath);
}
