import { type Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CUSTOMER_TOKEN_TTL_MS, customerFromRequest, issueToken, requireCustomer, revokedLongToken } from "../auth.js";
import { normalizePhone, phoneTail } from "../customer.js";
import { ADDRESS_FROM_RECIPIENT } from "../locationRequest.js";
import type { EmailSender } from "../email.js";
import { langOf } from "../i18n.js";
import { requestEmailOtp, requestOtp, verifyOtp, type OtpConfig } from "../otp.js";
import { checkPin, hashPin, newPinInput, PIN_LOCK_MS, PIN_MAX_ATTEMPTS, PIN_RESET_WINDOW_MS } from "../pin.js";
import { firstError, sendPrismaError } from "../util.js";

type Config = OtpConfig & { email?: EmailSender };

const phoneInput = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numéro togolais invalide (8 chiffres)" });
    return z.NEVER;
  }
  return phone;
});

const emailInput = z.string().trim().toLowerCase().max(120).email("Adresse e-mail invalide");
const codeInput = z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres");
const pinInput = newPinInput;

const verifyInput = z.object({
  phone: phoneInput,
  code: codeInput,
  name: z.string().trim().min(2).max(80).optional(),
  // Inscription : e-mail facultatif, pour se connecter aussi par e-mail.
  email: emailInput.optional(),
  // Inscription : case « conditions et confidentialité acceptées » cochée.
  acceptTerms: z.boolean().optional(),
});

const pinLoginInput = z.union([
  z.object({ phone: phoneInput, pin: z.string().regex(/^\d{4}$/, "Le code PIN a 4 chiffres") }),
  z.object({ email: emailInput, pin: z.string().regex(/^\d{4}$/, "Le code PIN a 4 chiffres") }),
]);

const profileInput = z
  .object({ name: z.string().trim().min(2, "Indiquez votre nom").max(80), email: z.union([emailInput, z.literal("").transform(() => null), z.null()]) })
  .partial()
  .refine((v) => v.name !== undefined || v.email !== undefined, "Rien à modifier");

// Formulaires de connexion : le message seul (« Le code PIN a 4 chiffres »), sans le nom du champ devant.
function plainError(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue && !(issue.code === "invalid_type" && issue.received === "undefined") ? issue.message : firstError(error);
}

// Clé des codes envoyés par e-mail dans OtpCode (à côté des numéros de téléphone).
const emailKey = (email: string) => `email:${email}`;
const NO_PIN = "Ce compte n'a pas encore de code PIN. Recevez un code par SMS pour le créer.";

const addressInput = z.object({
  label: z.string().trim().min(1, "Donnez un nom à l'adresse").max(40),
  quarter: z.string().trim().min(2, "Indiquez le quartier").max(80),
  landmark: z.string().trim().min(5, "Décrivez un repère (portail, boutique, église…)").max(200),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  zoneId: z.string().min(1, "Choisissez la zone"),
});

const MAX_ADDRESSES = 10;

// Client connecté (facultatif, on peut commander sans compte) : la commande est rattachée à son compte s'il existe encore.
export async function linkedCustomerId(prisma: PrismaClient, req: Request, secret: string): Promise<string | null> {
  const id = customerFromRequest(req, secret);
  if (!id) return null;
  const customer = await prisma.customer.findUnique({ where: { id }, select: { deletedAt: true, sessionsValidFrom: true } });
  return customer && !customer.deletedAt && !revokedLongToken(req, secret, customer.sessionsValidFrom) ? id : null;
}
const ORDER_DONE = ["DELIVERED", "CANCELLED"];

const addressSelect = {
  id: true,
  label: true,
  quarter: true,
  landmark: true,
  latitude: true,
  longitude: true,
  zone: { select: { id: true, name: true } },
} as const;

export function customerRouter(prisma: PrismaClient, config: Config) {
  const router = Router();
  const auth = requireCustomer(config.secret);

  // Rattache au compte les commandes passées sans compte avec le même numéro (8 derniers chiffres).
  async function linkHistory(customerId: string, phone: string) {
    const tail = phoneTail(phone);
    const candidates = await prisma.order.findMany({ where: { customerId: null, customerPhone: { contains: tail.slice(-4) } }, select: { id: true, customerPhone: true } });
    const ids = candidates.filter((o) => o.customerPhone.replace(/\D/g, "").slice(-8) === tail).map((o) => o.id);
    if (ids.length) await prisma.order.updateMany({ where: { id: { in: ids }, customerId: null }, data: { customerId } });
  }

  async function emailTaken(email: string, phone?: string) {
    const owner = await prisma.customer.findUnique({ where: { email }, select: { phone: true } });
    return !!owner && owner.phone !== phone;
  }

  const session = (customer: { id: string; phone: string; name: string | null; email: string | null; pinHash: string | null }) => ({
    token: issueToken(config.secret, Date.now(), "customer", customer.id, CUSTOMER_TOKEN_TTL_MS),
    customer: { phone: customer.phone, name: customer.name, email: customer.email, hasPin: !!customer.pinHash },
  });

  router.post("/otp/request", async (req, res) => {
    const parsed = z.object({ phone: phoneInput }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone } = parsed.data;
    const result = await requestOtp(prisma, config, phone, phone, "L'envoi des codes n'est pas encore disponible. Commandez sans compte en attendant.");
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json(result.body);
  });

  router.post("/otp/verify", async (req, res) => {
    const parsed = verifyInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone, code, name, email, acceptTerms } = parsed.data;
    if (email && (await emailTaken(email, phone))) {
      res.status(409).json({ error: "Cette adresse e-mail est déjà utilisée par un autre compte" });
      return;
    }
    const checked = await verifyOtp(prisma, config, phone, phone, code);
    if (!checked.ok) {
      res.status(checked.status).json(checked.body);
      return;
    }
    // Code vérifié : le client peut choisir (ou rechoisir) son PIN sans l'ancien pendant quelques minutes.
    const resetUntil = new Date(Date.now() + PIN_RESET_WINDOW_MS);
    const current = await prisma.customer.findUnique({ where: { phone }, select: { email: true, termsAcceptedAt: true } });
    const terms = acceptTerms && !current?.termsAcceptedAt ? { termsAcceptedAt: new Date() } : {};
    const customer = await prisma.customer.upsert({
      where: { phone },
      update: { lastLoginAt: new Date(), pinAttempts: 0, pinLockedUntil: null, pinResetUntil: resetUntil, ...(name ? { name } : {}), ...(email && !current?.email ? { email } : {}), ...terms },
      create: { phone, name: name ?? null, email: email ?? null, lastLoginAt: new Date(), pinResetUntil: resetUntil, ...terms },
    });
    await linkHistory(customer.id, phone);
    if (!customer.name) {
      // Reprend le nom de la dernière commande passée sans compte.
      const last = await prisma.order.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, select: { customerName: true } });
      if (last) customer.name = (await prisma.customer.update({ where: { id: customer.id }, data: { name: last.customerName } })).name;
    }
    res.json(session(customer));
  });

  // Connexion par code PIN, avec le numéro ou l'e-mail du compte.
  router.post("/pin/login", async (req, res) => {
    const parsed = pinLoginInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: plainError(parsed.error) });
      return;
    }
    const where = "phone" in parsed.data ? { phone: parsed.data.phone } : { email: parsed.data.email };
    const customer = await prisma.customer.findUnique({ where });
    // Même réponse pour un compte inconnu ou un PIN faux : on ne révèle pas quels numéros ont un compte.
    const wrong = "Identifiant ou code PIN incorrect";
    if (!customer || customer.deletedAt) {
      res.status(400).json({ error: wrong });
      return;
    }
    if (customer.pinLockedUntil && customer.pinLockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((customer.pinLockedUntil.getTime() - Date.now()) / 60_000);
      res.status(429).json({ error: `Trop d'essais. Réessayez dans ${minutes} min ou choisissez « Code PIN oublié ».` });
      return;
    }
    if (!customer.pinHash) {
      res.status(400).json({ error: NO_PIN, noPin: true });
      return;
    }
    if (!(await checkPin(parsed.data.pin, customer.pinHash))) {
      const attempts = customer.pinAttempts + 1;
      const locked = attempts >= PIN_MAX_ATTEMPTS;
      await prisma.customer.update({
        where: { id: customer.id },
        data: locked ? { pinAttempts: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MS) } : { pinAttempts: attempts },
      });
      res.status(locked ? 429 : 400).json({ error: locked ? "Trop d'essais. Réessayez dans 15 min ou choisissez « Code PIN oublié »." : wrong });
      return;
    }
    const updated = await prisma.customer.update({ where: { id: customer.id }, data: { pinAttempts: 0, pinLockedUntil: null, lastLoginAt: new Date() } });
    res.json(session(updated));
  });

  // PIN oublié par e-mail : code envoyé à l'adresse du compte. Réponse identique si l'adresse est inconnue.
  router.post("/email/request", async (req, res) => {
    const parsed = z.object({ email: emailInput }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: plainError(parsed.error) });
      return;
    }
    const { email } = parsed.data;
    const customer = await prisma.customer.findUnique({ where: { email }, select: { deletedAt: true } });
    if (!customer || customer.deletedAt) {
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
        ? { subject: `Your Zedeka code: ${code}`, text: `Your Zedeka code is ${code}. It is valid for 10 minutes.\n\nIf you didn't ask for it, ignore this email: your PIN stays the same.` }
        : { subject: `Votre code Zedeka : ${code}`, text: `Votre code Zedeka est ${code}. Il est valable 10 minutes.\n\nSi vous ne l'avez pas demandé, ignorez cet e-mail : votre code PIN ne change pas.` },
    );
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json({ email, ...result.body });
  });

  router.post("/email/verify", async (req, res) => {
    const parsed = z.object({ email: emailInput, code: codeInput }).safeParse(req.body);
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
    const customer = await prisma.customer.findUnique({ where: { email } });
    if (!customer || customer.deletedAt) {
      res.status(400).json({ error: "Code expiré. Demandez-en un nouveau." });
      return;
    }
    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date(), pinAttempts: 0, pinLockedUntil: null, pinResetUntil: new Date(Date.now() + PIN_RESET_WINDOW_MS) },
    });
    res.json(session(updated));
  });

  // Toutes les routes suivantes exigent un client connecté, et un compte non supprimé.
  router.use(auth, async (req, res, next) => {
    const customer = await prisma.customer.findUnique({ where: { id: res.locals.customerId }, select: { deletedAt: true, sessionsValidFrom: true } });
    if (!customer || customer.deletedAt || revokedLongToken(req, config.secret, customer.sessionsValidFrom)) {
      res.status(401).json({ error: "Connexion requise" });
      return;
    }
    next();
  });

  router.get("/me", async (_req, res) => {
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: res.locals.customerId },
      select: { phone: true, name: true, email: true, pinHash: true, createdAt: true, addresses: { orderBy: { createdAt: "asc" }, select: addressSelect } },
    });
    const { pinHash, ...rest } = customer;
    res.json({ ...rest, hasPin: !!pinHash });
  });

  router.patch("/me", async (req, res) => {
    const parsed = profileInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { email } = parsed.data;
    if (email) {
      const owner = await prisma.customer.findUnique({ where: { email }, select: { id: true } });
      if (owner && owner.id !== res.locals.customerId) {
        res.status(409).json({ error: "Cette adresse e-mail est déjà utilisée par un autre compte" });
        return;
      }
    }
    const customer = await prisma.customer.update({ where: { id: res.locals.customerId }, data: parsed.data, select: { phone: true, name: true, email: true } });
    res.json(customer);
  });

  // Téléphone perdu ou prêté : tous les jetons de ce compte cessent de marcher, celui-ci compris.
  router.post("/sessions/logout-all", async (_req, res) => {
    await prisma.customer.update({ where: { id: res.locals.customerId }, data: { sessionsValidFrom: new Date() } });
    res.status(204).end();
  });

  // Choisir ou changer son PIN. L'ancien est demandé, sauf juste après un code SMS ou e-mail vérifié (inscription, PIN oublié).
  router.put("/me/pin", async (req, res) => {
    const parsed = z.object({ pin: pinInput, currentPin: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: plainError(parsed.error) });
      return;
    }
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: res.locals.customerId } });
    const fresh = customer.pinResetUntil && customer.pinResetUntil.getTime() > Date.now();
    if (customer.pinHash && !fresh) {
      if (!parsed.data.currentPin || !(await checkPin(parsed.data.currentPin, customer.pinHash))) {
        res.status(400).json({ error: "Code PIN actuel incorrect" });
        return;
      }
    }
    await prisma.customer.update({
      where: { id: customer.id },
      data: { pinHash: await hashPin(parsed.data.pin), pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null },
    });
    res.json({ ok: true, hasPin: true });
  });

  // Suppression : les commandes restent (comptabilité) mais ne sont plus reliées au compte, qui est anonymisé.
  router.delete("/me", async (_req, res) => {
    const id = res.locals.customerId as string;
    await prisma.$transaction([
      prisma.customerAddress.deleteMany({ where: { customerId: id } }),
      prisma.order.updateMany({ where: { customerId: id }, data: { customerId: null } }),
      prisma.customer.update({ where: { id }, data: { phone: `supprime:${id}`, name: null, email: null, pinHash: null, deletedAt: new Date() } }),
    ]);
    res.status(204).end();
  });

  router.get("/addresses", async (_req, res) => {
    res.json(await prisma.customerAddress.findMany({ where: { customerId: res.locals.customerId }, orderBy: { createdAt: "asc" }, select: addressSelect }));
  });

  router.post("/addresses", async (req, res) => {
    const parsed = addressInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const customerId = res.locals.customerId as string;
    const [count, zone] = await Promise.all([
      prisma.customerAddress.count({ where: { customerId } }),
      prisma.zone.findFirst({ where: { id: parsed.data.zoneId, active: true } }),
    ]);
    if (count >= MAX_ADDRESSES) {
      res.status(400).json({ error: `${MAX_ADDRESSES} adresses au maximum` });
      return;
    }
    if (!zone) {
      res.status(400).json({ error: "Zone de livraison inconnue" });
      return;
    }
    res.status(201).json(await prisma.customerAddress.create({ data: { ...parsed.data, customerId }, select: addressSelect }));
  });

  router.patch("/addresses/:id", async (req, res) => {
    const parsed = addressInput.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    if (parsed.data.zoneId && !(await prisma.zone.findFirst({ where: { id: parsed.data.zoneId, active: true } }))) {
      res.status(400).json({ error: "Zone de livraison inconnue" });
      return;
    }
    const { count } = await prisma.customerAddress.updateMany({ where: { id: req.params.id, customerId: res.locals.customerId }, data: parsed.data });
    if (!count) {
      res.status(404).json({ error: "Adresse introuvable" });
      return;
    }
    res.json(await prisma.customerAddress.findUnique({ where: { id: req.params.id }, select: addressSelect }));
  });

  router.delete("/addresses/:id", async (req, res) => {
    try {
      const { count } = await prisma.customerAddress.deleteMany({ where: { id: req.params.id, customerId: res.locals.customerId } });
      if (!count) {
        res.status(404).json({ error: "Adresse introuvable" });
        return;
      }
      res.status(204).end();
    } catch (e) {
      if (!sendPrismaError(e, res)) throw e;
    }
  });

  // Destinataire déjà livré par ce client : dernière adresse et position, pour les reprendre dans un nouvel envoi.
  // Réservé au compte qui a envoyé ces colis : un numéro seul ne donne jamais l'adresse de quelqu'un.
  router.get("/recipients/:phone", async (req, res) => {
    const normalized = normalizePhone(req.params.phone);
    // Numéro saisi tel quel (espaces, indicatif) : comparaison sur les 8 derniers chiffres.
    const delivered = normalized
      ? await prisma.order.findMany({
          where: { customerId: res.locals.customerId, type: "PARCEL", status: "DELIVERED" },
          orderBy: { deliveredAt: "desc" },
          take: 200,
          select: { recipientPhone: true, recipientName: true, address: true, latitude: true, longitude: true, deliveredAt: true },
        })
      : [];
    const found = delivered.find((o) => (o.recipientPhone ?? "").replace(/\D/g, "").slice(-8) === phoneTail(normalized!));
    const last = found && { recipientName: found.recipientName, address: found.address, latitude: found.latitude, longitude: found.longitude, deliveredAt: found.deliveredAt };
    if (!last) {
      res.status(404).json({ error: "Aucune livraison précédente à ce numéro" });
      return;
    }
    const address = last.address === ADDRESS_FROM_RECIPIENT ? "" : last.address;
    res.json({ ...last, address });
  });

  // Repas et colis du client, du plus récent au plus ancien.
  router.get("/orders", async (_req, res) => {
    const customerId = res.locals.customerId as string;
    const orders = await prisma.order.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          code: true,
          type: true,
          fulfillment: true,
          status: true,
          total: true,
          createdAt: true,
          address: true,
          recipientName: true,
          restaurant: { select: { name: true, slug: true, logoUrl: true } },
          items: { select: { menuItemId: true, name: true, variantName: true, addons: true, quantity: true } },
        },
      });

    const history = [
      ...orders.map((o) =>
        o.type === "FOOD"
          ? {
              kind: "FOOD" as const,
              code: o.code,
              status: o.status,
              total: o.total,
              createdAt: o.createdAt,
              ongoing: !ORDER_DONE.includes(o.status),
              title: o.restaurant?.name ?? "Repas",
              subtitle: o.items.map((i) => `${i.quantity} × ${i.name}`).join(", "),
              logoUrl: o.restaurant?.logoUrl ?? null,
              fulfillment: o.fulfillment,
              restaurantSlug: o.restaurant?.slug ?? null,
              items: o.items.map((i) => ({
                menuItemId: i.menuItemId,
                name: i.name,
                variantName: i.variantName,
                addons: Array.isArray(i.addons) ? (i.addons as { name: string }[]).map((a) => a.name) : [],
                quantity: i.quantity,
              })),
            }
          : {
              kind: "PARCEL" as const,
              code: o.code,
              status: o.status,
              total: o.total,
              createdAt: o.createdAt,
              ongoing: !ORDER_DONE.includes(o.status),
              title: "Colis",
              subtitle: `Pour ${o.recipientName ?? "–"} · ${o.address}`,
              logoUrl: null,
            },
      ),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json(history);
  });

  return router;
}
