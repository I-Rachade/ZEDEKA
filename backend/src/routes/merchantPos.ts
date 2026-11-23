import type { Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isLowStock } from "../logistics.js";
import { cancelSale, createSale, dayBounds, daySummary, MAX_SALE_LINES, POS_METHODS, type SaleLine } from "../pos.js";
import { firstError, phone } from "../util.js";
import { HttpError } from "./adminWrite.js";
import { stockItemSelect } from "./merchantLogistics.js";

// Appli marchand : gestion de stock (articles, prix de vente, stock en boutique, seuil d'alerte, historique) et caisse
// (POS) qui vend le stock de la boutique (src/pos.ts). Le stock de l'entrepôt Zedeka, lui, n'est compté que par
// l'équipe (dépôts reçus, colis, retours).

type MerchantLike = { id: string; active: boolean };

const itemInput = z.object({
  name: z.string().trim().min(2, "Nom de l'article trop court").max(80),
  sku: z.string().trim().max(40).nullish(),
  price: z.number().int().min(0).max(10_000_000).nullish(),
  alertAt: z.number().int().min(0).max(100_000).nullish(),
});
const createInput = itemInput.extend({ shopQuantity: z.number().int().min(0).max(100_000).default(0) });
const adjustInput = z.object({
  delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, "Indiquez une quantité"),
  note: z.string().trim().max(200).optional(),
});
const saleInput = z.object({
  lines: z
    .array(z.object({ stockItemId: z.string().min(1), quantity: z.number().int().min(1).max(10_000) }))
    .min(1, "Ajoutez au moins un article")
    .max(MAX_SALE_LINES),
  discount: z.number().int().min(0).max(10_000_000).default(0),
  method: z.enum(POS_METHODS),
  received: z.number().int().min(0).max(100_000_000).nullish(),
  reference: z.string().trim().toUpperCase().max(40).nullish(),
  customerName: z.string().trim().max(80).nullish(),
  customerPhone: z.union([phone, z.literal("").transform(() => null), z.null()]).optional(),
  clientKey: z.string().trim().min(8).max(64).nullish(),
});

export function mountPosRoutes(router: Router, prisma: PrismaClient, merchantOf: (res: Response) => MerchantLike | null) {
  function shop(res: Response) {
    const m = merchantOf(res);
    if (!m) res.status(404).json({ error: "Créez d'abord votre boutique" });
    return m;
  }
  const cashier = (res: Response) => (res.locals.customer as { name: string | null } | undefined)?.name ?? null;
  function parse<S extends z.ZodTypeAny>(schema: S, body: unknown, res: Response): z.infer<S> | null {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return null;
    }
    return parsed.data;
  }
  const fail = (res: Response, e: unknown) => {
    if (!(e instanceof HttpError)) throw e;
    res.status(e.status).json({ error: e.message });
  };

  // Articles du marchand, avec leur stock en boutique et à l'entrepôt.
  router.get("/stock/items", async (_req, res) => {
    const m = shop(res);
    if (!m) return;
    const items = await prisma.stockItem.findMany({ where: { merchantId: m.id, archivedAt: null }, orderBy: { name: "asc" }, select: stockItemSelect });
    res.json(items.map((i) => ({ ...i, low: isLowStock(i) })));
  });

  router.post("/stock/items", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const data = parse(createInput, req.body, res);
    if (!data) return;
    const exists = await prisma.stockItem.findFirst({ where: { merchantId: m.id, name: data.name, archivedAt: null }, select: { id: true } });
    if (exists) {
      res.status(409).json({ error: "Un article porte déjà ce nom" });
      return;
    }
    const item = await prisma.stockItem.create({ data: { merchantId: m.id, ...data }, select: stockItemSelect });
    if (data.shopQuantity > 0) {
      await prisma.stockMovement.create({ data: { stockItemId: item.id, merchantId: m.id, kind: "ADJUST", place: "SHOP", quantity: data.shopQuantity, note: "Stock de départ", by: cashier(res) } });
    }
    res.status(201).json(item);
  });

  router.patch("/stock/items/:id", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const data = parse(itemInput.partial(), req.body, res);
    if (!data) return;
    const { count } = await prisma.stockItem.updateMany({ where: { id: req.params.id, merchantId: m.id, archivedAt: null }, data });
    if (!count) {
      res.status(404).json({ error: "Article introuvable" });
      return;
    }
    res.json(await prisma.stockItem.findUniqueOrThrow({ where: { id: req.params.id }, select: stockItemSelect }));
  });

  // Entrée ou sortie du stock de la boutique (arrivage, inventaire, casse) : jamais en dessous de zéro.
  router.post("/stock/items/:id/adjust", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const data = parse(adjustInput, req.body, res);
    if (!data) return;
    const { count } = await prisma.stockItem.updateMany({
      where: { id: req.params.id, merchantId: m.id, archivedAt: null, ...(data.delta < 0 ? { shopQuantity: { gte: -data.delta } } : {}) },
      data: { shopQuantity: { increment: data.delta } },
    });
    if (!count) {
      res.status(409).json({ error: data.delta < 0 ? "Stock en boutique insuffisant" : "Article introuvable" });
      return;
    }
    await prisma.stockMovement.create({ data: { stockItemId: req.params.id, merchantId: m.id, kind: "ADJUST", place: "SHOP", quantity: data.delta, note: data.note || null, by: cashier(res) } });
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: req.params.id }, select: stockItemSelect });
    res.json({ ...item, low: isLowStock(item) });
  });

  // Retirer un article : seulement quand il n'en reste plus à l'entrepôt (l'équipe le garde sinon).
  router.delete("/stock/items/:id", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const { count } = await prisma.stockItem.updateMany({ where: { id: req.params.id, merchantId: m.id, archivedAt: null, quantity: 0 }, data: { archivedAt: new Date() } });
    if (!count) {
      res.status(409).json({ error: "Il reste de cet article à l'entrepôt : expédiez-le ou demandez-le à Zedeka" });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/stock/items/:id/movements", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    res.json(
      await prisma.stockMovement.findMany({
        where: { stockItemId: req.params.id, merchantId: m.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, kind: true, place: true, quantity: true, note: true, by: true, orderId: true, saleId: true, createdAt: true },
      }),
    );
  });

  // Caisse : ventes d'une journée (aujourd'hui par défaut) et leurs totaux.
  router.get("/pos/sales", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const { start, end, key } = dayBounds(typeof req.query.day === "string" ? req.query.day : undefined);
    const sales = await prisma.posSale.findMany({ where: { merchantId: m.id, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "desc" }, take: 500 });
    const parsed = sales.map((s) => ({ ...s, lines: JSON.parse(s.lines) as SaleLine[], clientKey: undefined }));
    // Articles les plus vendus de la journée.
    const top = new Map<string, { name: string; quantity: number; amount: number }>();
    for (const s of parsed.filter((x) => !x.cancelledAt))
      for (const l of s.lines) {
        const row = top.get(l.stockItemId) ?? { name: l.name, quantity: 0, amount: 0 };
        row.quantity += l.quantity;
        row.amount += l.quantity * l.price;
        top.set(l.stockItemId, row);
      }
    res.json({ day: key, summary: daySummary(sales), top: [...top.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5), sales: parsed });
  });

  router.post("/pos/sales", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const data = parse(saleInput, req.body, res);
    if (!data) return;
    try {
      const { sale, lowStock } = await createSale(prisma, m.id, data, cashier(res));
      res.status(201).json({ sale: { ...sale, lines: JSON.parse(sale.lines) as SaleLine[], clientKey: undefined, change: sale.received != null ? sale.received - sale.total : 0 }, lowStock });
    } catch (e) {
      fail(res, e);
    }
  });

  router.post("/pos/sales/:id/cancel", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    try {
      const sale = await cancelSale(prisma, m.id, req.params.id, cashier(res));
      res.json({ ...sale, lines: JSON.parse(sale.lines) as SaleLine[], clientKey: undefined });
    } catch (e) {
      fail(res, e);
    }
  });
}
