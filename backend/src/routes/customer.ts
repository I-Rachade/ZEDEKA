import { type Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CUSTOMER_TOKEN_TTL_MS, customerFromRequest, issueToken, requireCustomer, revokedLongToken } from "../auth.js";
import { normalizePhone, phoneTail } from "../customer.js";
import { ADDRESS_FROM_RECIPIENT } from "../locationRequest.js";
import { requestOtp, verifyOtp, type OtpConfig } from "../otp.js";
import { firstError, sendPrismaError } from "../util.js";

type Config = OtpConfig;

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
    const { phone, code, name } = parsed.data;
    const checked = await verifyOtp(prisma, config, phone, phone, code);
    if (!checked.ok) {
      res.status(checked.status).json(checked.body);
      return;
    }
    const customer = await prisma.customer.upsert({
      where: { phone },
      update: { lastLoginAt: new Date(), ...(name ? { name } : {}) },
      create: { phone, name: name ?? null, lastLoginAt: new Date() },
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

  // Téléphone perdu ou prêté : tous les jetons de ce compte cessent de marcher, celui-ci compris.
  router.post("/sessions/logout-all", async (_req, res) => {
    await prisma.customer.update({ where: { id: res.locals.customerId }, data: { sessionsValidFrom: new Date() } });
    res.status(204).end();
  });

  // Suppression : les commandes restent (comptabilité) mais ne sont plus reliées au compte, qui est anonymisé.
  router.delete("/me", async (_req, res) => {
    const id = res.locals.customerId as string;
    await prisma.$transaction([
      prisma.customerAddress.deleteMany({ where: { customerId: id } }),
      prisma.order.updateMany({ where: { customerId: id }, data: { customerId: null } }),
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
