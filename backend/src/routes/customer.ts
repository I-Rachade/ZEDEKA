import { type Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CUSTOMER_TOKEN_TTL_MS, customerFromRequest, issueToken, requireCustomer } from "../auth.js";
import {
  hashOtp,
  newOtpCode,
  normalizePhone,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_DELAY_MS,
  OTP_TTL_MS,
  phoneTail,
} from "../customer.js";
import { TRIP_OPEN } from "../rental.js";
import { firstError, sendPrismaError } from "../util.js";

// Envoi du code par SMS ou WhatsApp. Sans fournisseur configuré, l'API renvoie le code en mode test.
export type OtpSender = (phone: string, code: string) => Promise<void>;

type Config = { secret: string; sendOtp?: OtpSender; devCodes: boolean };

const phoneInput = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numéro togolais invalide (8 chiffres)" });
    return z.NEVER;
  }
  return phone;
});

const verifyInput = z.object({
  phone: phoneInput,
  code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres"),
  name: z.string().trim().min(2).max(80).optional(),
});

const profileInput = z.object({ name: z.string().trim().min(2, "Indiquez votre nom").max(80) });

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
  const customer = await prisma.customer.findUnique({ where: { id }, select: { deletedAt: true } });
  return customer && !customer.deletedAt ? id : null;
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

  // Rattache au compte les commandes et réservations passées sans compte avec le même numéro.
  async function linkHistory(customerId: string, phone: string) {
    const tail = phoneTail(phone);
    await prisma.$executeRaw`UPDATE "Order" SET "customerId" = ${customerId} WHERE "customerId" IS NULL AND right(regexp_replace("customerPhone", '[^0-9]', '', 'g'), 8) = ${tail}`;
    await prisma.$executeRaw`UPDATE "Trip" SET "customerId" = ${customerId} WHERE "customerId" IS NULL AND right(regexp_replace("customerPhone", '[^0-9]', '', 'g'), 8) = ${tail}`;
  }

  router.post("/otp/request", async (req, res) => {
    const parsed = z.object({ phone: phoneInput }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone } = parsed.data;
    const now = Date.now();
    const recent = await prisma.otpCode.findMany({
      where: { phone, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
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
      res.status(503).json({ error: "L'envoi des codes n'est pas encore disponible. Commandez sans compte en attendant." });
      return;
    }

    const code = newOtpCode();
    await prisma.otpCode.create({ data: { phone, codeHash: hashOtp(phone, code, config.secret), expiresAt: new Date(now + OTP_TTL_MS) } });
    if (config.sendOtp) await config.sendOtp(phone, code);
    res.json({ phone, expiresInMinutes: OTP_TTL_MS / 60_000, ...(config.devCodes && !config.sendOtp ? { devCode: code } : {}) });
  });

  router.post("/otp/verify", async (req, res) => {
    const parsed = verifyInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { phone, code, name } = parsed.data;
    const otp = await prisma.otpCode.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: "desc" } });
    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "Code expiré. Demandez-en un nouveau." });
      return;
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Trop d'essais. Demandez un nouveau code." });
      return;
    }
    if (otp.codeHash !== hashOtp(phone, code, config.secret)) {
      const { attempts } = await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const left = OTP_MAX_ATTEMPTS - attempts;
      res.status(400).json({
        error: left > 0 ? `Code incorrect. Encore ${left} essai${left > 1 ? "s" : ""}.` : "Trop d'essais. Demandez un nouveau code.",
      });
      return;
    }

    await prisma.otpCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: new Date() } });
    const customer = await prisma.customer.upsert({
      where: { phone },
      // L'écran de connexion annonce les conditions : se connecter vaut acceptation de la version en vigueur.
      update: { lastLoginAt: new Date(), termsAcceptedAt: new Date(), ...(name ? { name } : {}) },
      create: { phone, name: name ?? null, lastLoginAt: new Date(), termsAcceptedAt: new Date() },
    });
    await linkHistory(customer.id, phone);
    if (!customer.name) {
      // Reprend le nom de la dernière commande passée sans compte.
      const last = await prisma.order.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, select: { customerName: true } });
      if (last) customer.name = (await prisma.customer.update({ where: { id: customer.id }, data: { name: last.customerName } })).name;
    }
    res.json({
      token: issueToken(config.secret, Date.now(), "customer", customer.id, CUSTOMER_TOKEN_TTL_MS),
      customer: { phone: customer.phone, name: customer.name },
    });
  });

  // Toutes les routes suivantes exigent un client connecté, et un compte non supprimé.
  router.use(auth, async (_req, res, next) => {
    const customer = await prisma.customer.findUnique({ where: { id: res.locals.customerId }, select: { deletedAt: true } });
    if (!customer || customer.deletedAt) {
      res.status(401).json({ error: "Connexion requise" });
      return;
    }
    next();
  });

  router.get("/me", async (_req, res) => {
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: res.locals.customerId },
      select: { phone: true, name: true, createdAt: true, addresses: { orderBy: { createdAt: "asc" }, select: addressSelect } },
    });
    res.json(customer);
  });

  router.patch("/me", async (req, res) => {
    const parsed = profileInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const customer = await prisma.customer.update({ where: { id: res.locals.customerId }, data: parsed.data, select: { phone: true, name: true } });
    res.json(customer);
  });

  // Suppression : les commandes restent (comptabilité) mais ne sont plus reliées au compte, qui est anonymisé.
  router.delete("/me", async (_req, res) => {
    const id = res.locals.customerId as string;
    await prisma.$transaction([
      prisma.customerAddress.deleteMany({ where: { customerId: id } }),
      prisma.order.updateMany({ where: { customerId: id }, data: { customerId: null } }),
      prisma.trip.updateMany({ where: { customerId: id }, data: { customerId: null } }),
      prisma.customer.update({ where: { id }, data: { phone: `supprime:${id}`, name: null, deletedAt: new Date() } }),
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

  // Repas, colis et locations du client, du plus récent au plus ancien.
  router.get("/orders", async (_req, res) => {
    const customerId = res.locals.customerId as string;
    const [orders, trips] = await Promise.all([
      prisma.order.findMany({
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
      }),
      prisma.trip.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          code: true,
          status: true,
          total: true,
          createdAt: true,
          scheduledAt: true,
          provider: { select: { name: true, slug: true, logoUrl: true } },
          vehicles: { select: { name: true, quantity: true } },
        },
      }),
    ]);

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
      ...trips.map((t) => ({
        kind: "RENTAL" as const,
        code: t.code,
        status: t.status,
        total: t.total,
        createdAt: t.createdAt,
        ongoing: (TRIP_OPEN as string[]).includes(t.status),
        title: t.provider.name,
        subtitle: t.vehicles.map((v) => (v.quantity > 1 ? `${v.quantity} × ${v.name}` : v.name)).join(", "),
        logoUrl: t.provider.logoUrl,
        scheduledAt: t.scheduledAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json(history);
  });

  return router;
}
