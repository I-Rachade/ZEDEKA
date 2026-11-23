import { Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { billingError, COMPANY_KINDS, companiesOf, invoiceFor, MONTH, monthOf, spentThisMonth } from "../companies.js";
import { normalizePhone } from "../customer.js";
import { hashLocationToken, isTokenShape, newLocationToken } from "../locationRequest.js";
import type { Notifier } from "../notify.js";
import { PlanError, placeFoodOrder } from "../plannedMeals.js";
import { normalizeCode, priceOrder, publicCode, type CartLine } from "../pricing.js";
import { firstError } from "../util.js";

// Comptes entreprise (admin), facturation à l'entreprise et commandes groupées (client et lien public).
// Voir src/companies.ts.

const phoneInput = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numéro togolais invalide (8 chiffres)" });
    return z.NEVER;
  }
  return phone;
});

const cartLines = z
  .array(
    z.object({
      menuItemId: z.string().min(1),
      quantity: z.number().int().min(1).max(20),
      variantId: z.string().optional(),
      addonIds: z.array(z.string()).max(20).optional(),
      choices: z.array(z.string().max(60)).max(10).optional(),
    }),
  )
  .min(1, "Choisissez au moins un plat")
  .max(20, "Trop de plats");

const send = (res: Response, status: number, error: string) => void res.status(status).json({ error });

// ---------- Admin ----------

const companyInput = z.object({
  name: z.string().trim().min(2, "Indiquez le nom").max(120),
  kind: z.enum(COMPANY_KINDS).default("OFFICE"),
  contactName: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(20).default(""),
  email: z.union([z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(120), z.literal("").transform(() => null), z.null()]).optional(),
  address: z.string().trim().max(200).default(""),
  taxId: z.string().trim().max(40).nullish(),
  monthlyLimit: z.number().int().min(0).max(100_000_000).default(0),
  active: z.boolean().optional(),
});

export function adminCompaniesRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/companies", async (_req, res) => {
    const now = new Date();
    const companies = await prisma.company.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: { where: { active: true } } } } } });
    const list = await Promise.all(companies.map(async (c) => ({ ...c, members: c._count.members, spentThisMonth: await spentThisMonth(prisma, c.id, now) })));
    res.json(list.map(({ _count: _c, ...c }) => c));
  });

  router.post("/companies", async (req, res) => {
    const parsed = companyInput.safeParse(req.body);
    if (!parsed.success) return send(res, 400, firstError(parsed.error));
    res.status(201).json(await prisma.company.create({ data: { ...parsed.data, email: parsed.data.email ?? null, taxId: parsed.data.taxId ?? null } }));
  });

  router.patch("/companies/:id", async (req, res) => {
    const parsed = companyInput.partial().safeParse(req.body);
    if (!parsed.success) return send(res, 400, firstError(parsed.error));
    const { count } = await prisma.company.updateMany({ where: { id: String(req.params.id) }, data: parsed.data });
    if (!count) return send(res, 404, "Entreprise introuvable");
    res.json({ ok: true });
  });

  router.get("/companies/:id", async (req, res) => {
    const company = await prisma.company.findUnique({
      where: { id: String(req.params.id) },
      include: { members: { orderBy: { name: "asc" } }, invoices: { orderBy: { month: "desc" }, take: 24 } },
    });
    if (!company) return send(res, 404, "Entreprise introuvable");
    res.json({ ...company, spentThisMonth: await spentThisMonth(prisma, company.id), currentMonth: monthOf(new Date()) });
  });

  router.post("/companies/:id/members", async (req, res) => {
    const parsed = z.object({ phone: phoneInput, name: z.string().trim().max(80).default("") }).safeParse(req.body);
    if (!parsed.success) return send(res, 400, firstError(parsed.error));
    const companyId = String(req.params.id);
    if (!(await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }))) return send(res, 404, "Entreprise introuvable");
    const member = await prisma.companyMember.upsert({
      where: { companyId_phone: { companyId, phone: parsed.data.phone } },
      update: { name: parsed.data.name, active: true },
      create: { companyId, ...parsed.data },
    });
    res.status(201).json(member);
  });

  router.patch("/companies/:id/members/:memberId", async (req, res) => {
    const parsed = z.object({ name: z.string().trim().max(80).optional(), active: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return send(res, 400, firstError(parsed.error));
    const { count } = await prisma.companyMember.updateMany({ where: { id: String(req.params.memberId), companyId: String(req.params.id) }, data: parsed.data });
    if (!count) return send(res, 404, "Membre introuvable");
    res.json({ ok: true });
  });

  // Facture d'un mois (détail imprimable). Un mois terminé est figé (total et nombre de commandes) à la lecture.
  router.get("/companies/:id/invoices/:month", async (req, res) => {
    const month = String(req.params.month);
    if (!MONTH.test(month)) return send(res, 400, "Mois invalide (AAAA-MM)");
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return send(res, 404, "Entreprise introuvable");
    const invoice = await invoiceFor(prisma, company.id, month);
    const closed = month < monthOf(new Date());
    const saved = closed
      ? await prisma.companyInvoice.upsert({
          where: { companyId_month: { companyId: company.id, month } },
          update: { total: invoice.total, orders: invoice.count },
          create: { companyId: company.id, month, total: invoice.total, orders: invoice.count },
        })
      : await prisma.companyInvoice.findUnique({ where: { companyId_month: { companyId: company.id, month } } });
    res.json({ company, closed, paidAt: saved?.paidAt ?? null, paidNote: saved?.paidNote ?? null, number: `FZ-${month.replace("-", "")}-${company.id.slice(-5).toUpperCase()}`, ...invoice });
  });

  router.post("/companies/:id/invoices/:month/paid", async (req, res) => {
    const month = String(req.params.month);
    const parsed = z.object({ paid: z.boolean(), note: z.string().trim().max(200).nullish() }).safeParse(req.body);
    if (!MONTH.test(month) || !parsed.success) return send(res, 400, "Données invalides");
    const companyId = String(req.params.id);
    if (!(await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }))) return send(res, 404, "Entreprise introuvable");
    const invoice = await invoiceFor(prisma, companyId, month);
    const data = { paidAt: parsed.data.paid ? new Date() : null, paidNote: parsed.data.note ?? null, total: invoice.total, orders: invoice.count };
    await prisma.companyInvoice.upsert({ where: { companyId_month: { companyId, month } }, update: data, create: { companyId, month, ...data } });
    res.json({ ok: true });
  });

  return router;
}

// ---------- Commandes groupées ----------

type GroupLine = { id: string; participant: string; items: string; subtotal: number };

async function menuFor(prisma: PrismaClient, restaurantId: string, ids: string[]) {
  return prisma.menuItem.findMany({
    where: { restaurantId, available: true, id: { in: ids } },
    select: { id: true, name: true, price: true, variants: { select: { id: true, name: true, price: true } }, addons: { where: { available: true }, select: { id: true, name: true, price: true } }, options: true, stock: true },
  });
}

// Panier commun : toutes les parts fusionnées, et le récapitulatif « qui a pris quoi » pour la note du restaurant.
export async function mergeLines(prisma: PrismaClient, restaurantId: string, lines: GroupLine[]) {
  const items = lines.flatMap((l) => JSON.parse(l.items) as CartLine[]);
  const menu = await menuFor(prisma, restaurantId, [...new Set(items.map((i) => i.menuItemId))]);
  const who = lines.map((l) => {
    const mine = JSON.parse(l.items) as CartLine[];
    const names = mine.map((i) => `${i.quantity} × ${menu.find((m) => m.id === i.menuItemId)?.name ?? "?"}`).join(", ");
    return `${l.participant} : ${names}`;
  });
  return { items, who };
}

async function groupView(prisma: PrismaClient, code: string) {
  const group = await prisma.groupOrder.findUnique({ where: { code }, include: { lines: { orderBy: { createdAt: "asc" } } } });
  if (!group) return null;
  const [restaurant, company] = await Promise.all([
    prisma.restaurant.findUnique({ where: { id: group.restaurantId }, select: { slug: true, name: true, minOrderAmount: true } }),
    group.companyId ? prisma.company.findUnique({ where: { id: group.companyId }, select: { name: true } }) : null,
  ]);
  const ids = [...new Set(group.lines.flatMap((l) => (JSON.parse(l.items) as CartLine[]).map((i) => i.menuItemId)))];
  const menu = ids.length ? await prisma.menuItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return {
    group,
    view: {
      code: group.code,
      status: group.status,
      hostName: group.hostName.split(" ")[0],
      deadline: group.deadline,
      address: group.address,
      company: company?.name ?? null,
      orderCode: group.orderCode,
      restaurant,
      lines: group.lines.map((l) => ({
        id: l.id,
        participant: l.participant,
        subtotal: l.subtotal,
        items: (JSON.parse(l.items) as CartLine[]).map((i) => ({ name: menu.find((m) => m.id === i.menuItemId)?.name ?? "Plat retiré", quantity: i.quantity })),
      })),
      subtotal: group.lines.reduce((s, l) => s + l.subtotal, 0),
    },
  };
}

// Lien public /groupe/<code> : voir la commande, ajouter sa part (prénom + plats), la retirer avec sa clé.
export function groupOrderPublicRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/group-orders/:code", async (req, res) => {
    const found = await groupView(prisma, normalizeCode(String(req.params.code)));
    if (!found) return send(res, 404, "Commande groupée introuvable");
    res.json(found.view);
  });

  router.post("/group-orders/:code/lines", async (req, res) => {
    const parsed = z.object({ participant: z.string().trim().min(2, "Indiquez votre prénom").max(40), items: cartLines }).safeParse(req.body);
    if (!parsed.success) return send(res, 400, firstError(parsed.error));
    const group = await prisma.groupOrder.findUnique({ where: { code: normalizeCode(String(req.params.code)) }, include: { _count: { select: { lines: true } } } });
    if (!group) return send(res, 404, "Commande groupée introuvable");
    if (group.status !== "OPEN" || (group.deadline && group.deadline < new Date())) return send(res, 409, "Cette commande groupée est fermée");
    if (group._count.lines >= 60) return send(res, 409, "Commande groupée complète (60 parts)");
    const menu = await menuFor(prisma, group.restaurantId, parsed.data.items.map((i) => i.menuItemId));
    let subtotal: number;
    try {
      subtotal = priceOrder(parsed.data.items, menu, 0).subtotal;
    } catch (e) {
      return send(res, 400, (e as Error).message);
    }
    const key = newLocationToken();
    const line = await prisma.groupOrderLine.create({
      data: { groupOrderId: group.id, participant: parsed.data.participant, items: JSON.stringify(parsed.data.items), subtotal, editKeyHash: hashLocationToken(key) },
    });
    res.status(201).json({ id: line.id, editKey: key, subtotal });
  });

  router.delete("/group-orders/:code/lines/:id", async (req, res) => {
    const key = String(req.get("x-edit-key") ?? "");
    if (!isTokenShape(key)) return send(res, 403, "Vous ne pouvez retirer que votre part");
    const group = await prisma.groupOrder.findUnique({ where: { code: normalizeCode(String(req.params.code)) }, select: { id: true, status: true } });
    if (!group || group.status !== "OPEN") return send(res, 409, "Cette commande groupée est fermée");
    const { count } = await prisma.groupOrderLine.deleteMany({ where: { id: String(req.params.id), groupOrderId: group.id, editKeyHash: hashLocationToken(key) } });
    if (!count) return send(res, 403, "Vous ne pouvez retirer que votre part");
    res.json({ ok: true });
  });

  return router;
}

// Côté client connecté (/api/customer) : mes entreprises, créer et envoyer une commande groupée.
export function companyCustomerRoutes(router: Router, prisma: PrismaClient, notifier: Notifier) {
  const me = (res: Response) => prisma.customer.findUnique({ where: { id: res.locals.customerId }, select: { id: true, phone: true, name: true } });

  router.get("/companies", async (_req, res) => {
    const customer = await me(res);
    res.json((await companiesOf(prisma, customer?.phone ?? "")).map(({ id, name, kind }) => ({ id, name, kind })));
  });

  router.get("/group-orders", async (_req, res) => {
    const rows = await prisma.groupOrder.findMany({
      where: { hostCustomerId: res.locals.customerId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { code: true, status: true, restaurantId: true, createdAt: true, orderCode: true, _count: { select: { lines: true } } },
    });
    const restaurants = await prisma.restaurant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.restaurantId))] } }, select: { id: true, name: true } });
    res.json(rows.map(({ _count, restaurantId, ...r }) => ({ ...r, parts: _count.lines, restaurant: restaurants.find((x) => x.id === restaurantId)?.name ?? "" })));
  });

  router.post("/group-orders", async (req, res) => {
    const parsed = z
      .object({
        restaurantSlug: z.string().min(1),
        address: z.string().trim().max(300).default(""),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        deadline: z.string().datetime({ offset: true }).optional(),
        companyId: z.string().optional(),
        hostName: z.string().trim().min(2).max(80).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return send(res, 400, firstError(parsed.error));
    const input = parsed.data;
    const customer = await me(res);
    if (!customer) return send(res, 401, "Connexion requise");
    const restaurant = await prisma.restaurant.findFirst({ where: { slug: input.restaurantSlug, active: true, deletedAt: null }, select: { id: true } });
    if (!restaurant) return send(res, 404, "Restaurant introuvable");
    if (input.companyId && !(await companiesOf(prisma, customer.phone)).some((c) => c.id === input.companyId))
      return send(res, 403, "Votre numéro n'est pas inscrit dans ce compte entreprise");
    const open = await prisma.groupOrder.count({ where: { hostCustomerId: customer.id, status: "OPEN" } });
    if (open >= 5) return send(res, 400, "Vous avez déjà 5 commandes groupées ouvertes");
    for (let attempt = 0; ; attempt++) {
      try {
        const group = await prisma.groupOrder.create({
          data: {
            code: publicCode("ZG"),
            restaurantId: restaurant.id,
            hostCustomerId: customer.id,
            hostName: input.hostName ?? customer.name ?? "Organisateur",
            hostPhone: customer.phone,
            companyId: input.companyId ?? null,
            address: input.address,
            latitude: input.latitude,
            longitude: input.longitude,
            deadline: input.deadline ? new Date(input.deadline) : null,
          },
        });
        return void res.status(201).json({ code: group.code });
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002" || attempt >= 3) throw e;
      }
    }
  });

  async function hosted(res: Response, code: string) {
    const found = await groupView(prisma, normalizeCode(code));
    if (!found || found.group.hostCustomerId !== res.locals.customerId) {
      send(res, 404, "Commande groupée introuvable");
      return null;
    }
    return found;
  }

  // L'organisateur retire une part (erreur, doublon).
  router.delete("/group-orders/:code/lines/:id", async (req, res) => {
    const found = await hosted(res, String(req.params.code));
    if (!found) return;
    if (found.group.status !== "OPEN") return send(res, 409, "Cette commande groupée est fermée");
    await prisma.groupOrderLine.deleteMany({ where: { id: String(req.params.id), groupOrderId: found.group.id } });
    res.json({ ok: true });
  });

  router.post("/group-orders/:code/cancel", async (req, res) => {
    const found = await hosted(res, String(req.params.code));
    if (!found) return;
    await prisma.groupOrder.updateMany({ where: { id: found.group.id, status: "OPEN" }, data: { status: "CANCELLED" } });
    res.json({ ok: true });
  });

  // Envoi : une seule commande au restaurant, livrée au point choisi, note « qui a pris quoi ».
  router.post("/group-orders/:code/submit", async (req, res) => {
    const found = await hosted(res, String(req.params.code));
    if (!found) return;
    const { group } = found;
    if (group.status !== "OPEN") return send(res, 409, "Cette commande groupée a déjà été envoyée");
    if (!group.lines.length) return send(res, 400, "Personne n'a encore ajouté de plat");
    // Verrou : une seule soumission, même en double clic.
    const { count } = await prisma.groupOrder.updateMany({ where: { id: group.id, status: "OPEN" }, data: { status: "SUBMITTING" } });
    if (!count) return send(res, 409, "Cette commande groupée a déjà été envoyée");
    try {
      const { items, who } = await mergeLines(prisma, group.restaurantId, group.lines);
      if (group.companyId) {
        const error = await billingError(prisma, group.companyId, group.hostPhone, found.view.subtotal);
        if (error) throw new PlanError(error);
      }
      const order = await placeFoodOrder(prisma, notifier, {
        customerId: group.hostCustomerId,
        restaurantId: group.restaurantId,
        customerName: group.hostName,
        customerPhone: group.hostPhone,
        address: group.address,
        latitude: group.latitude,
        longitude: group.longitude,
        note: who.join(" ; "),
        items,
        label: `👥 Commande groupée (${group.lines.length} personnes)`,
        companyId: group.companyId,
      });
      await prisma.groupOrder.update({ where: { id: group.id }, data: { status: "SUBMITTED", orderId: order.id, orderCode: order.code } });
      res.json({ orderCode: order.code, total: order.total });
    } catch (e) {
      await prisma.groupOrder.update({ where: { id: group.id }, data: { status: "OPEN" } });
      if (e instanceof PlanError) return send(res, 400, e.message);
      throw e;
    }
  });
}
