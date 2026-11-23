import { Router, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { OPEN_RETURN, openReturn, parseStockLines, restoreStock, RETURN_REASONS, warehouseOf, type ReturnReason } from "../logistics.js";
import type { Notifier } from "../notify.js";
import { normalizeCode } from "../pricing.js";
import { staffName } from "../team.js";
import { firstError, getSettings } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Admin « Logistique » (src/logistics.ts) : dépôts de marchandise à recevoir, stock des marchands à l'entrepôt,
// colis à préparer depuis le stock, retours, frais logistiques. Les réglages (adresse de l'entrepôt, tarifs) sont
// sous /settings, réservés au directeur.

type DepositLine = { stockItemId: string | null; name: string; sku: string | null; quantity: number; fromShop?: boolean; received?: number };

const receiveInput = z.object({
  // Quantité comptée pour chaque ligne du dépôt (même ordre), et emplacement facultatif.
  lines: z.array(z.object({ received: z.number().int().min(0).max(10_000), location: z.string().trim().max(60).optional() })).min(1),
});
const adjustInput = z.object({ delta: z.number().int().min(-10_000).max(10_000).refine((n) => n !== 0, "Indiquez une quantité"), note: z.string().trim().min(3, "Indiquez la raison").max(200) });
const itemInput = z.object({ name: z.string().trim().min(2).max(80).optional(), sku: z.string().trim().max(40).nullish(), location: z.string().trim().max(60).nullish() });
const returnInput = z.object({
  code: z.string().trim().min(3).max(20),
  reason: z.enum(Object.keys(RETURN_REASONS) as [ReturnReason, ...ReturnReason[]]),
  note: z.string().trim().max(300).optional(),
  waiveFee: z.boolean().default(false),
});
const returnStatusInput = z.object({ status: z.enum(["AT_WAREHOUSE", "RESTOCKED", "HANDED_BACK"]) });
const settingsInput = z
  .object({
    warehouseAddress: z.string().trim().max(300),
    warehouseLatitude: z.number().min(-90).max(90).nullable(),
    warehouseLongitude: z.number().min(-180).max(180).nullable(),
    storageFeePerItem: z.number().int().min(0).max(100_000),
    returnFee: z.number().int().min(0).max(100_000),
  })
  .partial()
  .refine((s) => (s.warehouseLatitude === undefined) === (s.warehouseLongitude === undefined), { message: "Position de l'entrepôt incomplète" });

// Colis partis du stock, pas encore remis au livreur.
const TO_PREPARE: Prisma.OrderWhereInput = { stockLines: { not: null }, status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] } };
const merchantBrief = { select: { id: true, shopName: true, phone: true } } as const;

const fail = (res: Response, e: unknown) => {
  if (!(e instanceof HttpError)) throw e;
  res.status(e.status).json({ error: e.message });
};

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown, res: Response): z.infer<S> | null {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: firstError(parsed.error) });
    return null;
  }
  return parsed.data;
}

export function adminLogisticsRouter(prisma: PrismaClient, config: { notifier: Notifier }) {
  const router = Router();

  router.get("/logistics/summary", async (_req, res) => {
    const [settings, deposits, toPrepare, returns, items, charges] = await Promise.all([
      getSettings(prisma),
      prisma.stockDeposit.count({ where: { status: "PENDING" } }),
      prisma.order.count({ where: TO_PREPARE }),
      prisma.parcelReturn.groupBy({ by: ["status"], where: { status: { in: OPEN_RETURN } }, _count: { _all: true } }),
      prisma.stockItem.findMany({ where: { archivedAt: null, quantity: { gt: 0 } }, select: { merchantId: true, quantity: true } }),
      prisma.logisticsCharge.aggregate({ _sum: { amount: true }, where: { payoutId: null } }),
    ]);
    const count = (s: string) => returns.find((r) => r.status === s)?._count._all ?? 0;
    res.json({
      warehouse: warehouseOf(settings),
      settings: {
        warehouseAddress: settings.warehouseAddress,
        warehouseLatitude: settings.warehouseLatitude,
        warehouseLongitude: settings.warehouseLongitude,
        storageFeePerItem: settings.storageFeePerItem,
        returnFee: settings.returnFee,
      },
      pendingDeposits: deposits,
      toPrepare,
      returnsToCollect: count("TO_COLLECT"),
      returnsAtWarehouse: count("AT_WAREHOUSE"),
      units: items.reduce((s, i) => s + i.quantity, 0),
      merchantsWithStock: new Set(items.map((i) => i.merchantId)).size,
      chargesDue: charges._sum.amount ?? 0,
    });
  });

  router.get("/logistics/deposits", async (req, res) => {
    const status = z.enum(["PENDING", "RECEIVED", "CANCELLED"]).catch("PENDING").parse(req.query.status);
    const rows = await prisma.stockDeposit.findMany({ where: { status }, orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" }, take: 100, include: { merchant: merchantBrief } });
    res.json(rows.map((d) => ({ ...d, lines: JSON.parse(d.lines) as DepositLine[] })));
  });

  // Réception d'un dépôt : chaque ligne comptée entre en stock (article existant, ou créé au nom donné).
  router.post("/logistics/deposits/:id/receive", async (req, res) => {
    const data = parse(receiveInput, req.body, res);
    if (!data) return;
    const deposit = await prisma.stockDeposit.findUnique({ where: { id: req.params.id } });
    if (!deposit || deposit.status !== "PENDING") {
      res.status(409).json({ error: "Ce dépôt a déjà été reçu ou annulé" });
      return;
    }
    const lines = JSON.parse(deposit.lines) as DepositLine[];
    if (data.lines.length !== lines.length) {
      res.status(400).json({ error: "Comptez chaque ligne du dépôt" });
      return;
    }
    const by = staffName(res);
    // Verrou : un seul membre de l'équipe enregistre la réception.
    const { count } = await prisma.stockDeposit.updateMany({ where: { id: deposit.id, status: "PENDING" }, data: { status: "RECEIVED", receivedAt: new Date(), receivedBy: by } });
    if (!count) {
      res.status(409).json({ error: "Ce dépôt a déjà été reçu ou annulé" });
      return;
    }
    const saved: DepositLine[] = [];
    for (const [i, line] of lines.entries()) {
      const { received, location } = data.lines[i];
      let itemId = line.stockItemId;
      if (!itemId) {
        const same = await prisma.stockItem.findFirst({ where: { merchantId: deposit.merchantId, name: line.name, archivedAt: null }, select: { id: true } });
        itemId = same?.id ?? (await prisma.stockItem.create({ data: { merchantId: deposit.merchantId, name: line.name, sku: line.sku, location: location || null }, select: { id: true } })).id;
      }
      if (received > 0) {
        await prisma.stockItem.update({ where: { id: itemId }, data: { quantity: { increment: received }, archivedAt: null, ...(location ? { location } : {}) } });
        await prisma.stockMovement.create({ data: { stockItemId: itemId, merchantId: deposit.merchantId, kind: "DEPOSIT", quantity: received, depositId: deposit.id, by } });
        // Pris dans le stock de la boutique : il en sort (jamais en dessous de zéro).
        if (line.fromShop) {
          const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId }, select: { shopQuantity: true } });
          const out = Math.min(received, item.shopQuantity);
          if (out > 0) {
            await prisma.stockItem.updateMany({ where: { id: itemId, shopQuantity: { gte: out } }, data: { shopQuantity: { decrement: out } } });
            await prisma.stockMovement.create({ data: { stockItemId: itemId, merchantId: deposit.merchantId, kind: "DEPOSIT", place: "SHOP", quantity: -out, depositId: deposit.id, by } });
          }
        }
      }
      saved.push({ ...line, stockItemId: itemId, received });
    }
    const updated = await prisma.stockDeposit.update({ where: { id: deposit.id }, data: { lines: JSON.stringify(saved) }, include: { merchant: merchantBrief } });
    res.json({ ...updated, lines: saved });
  });

  // Stock : marchands qui ont des articles à l'entrepôt, ou les articles d'un marchand avec leurs derniers mouvements.
  router.get("/logistics/stock", async (req, res) => {
    const merchantId = typeof req.query.merchantId === "string" ? req.query.merchantId : undefined;
    if (!merchantId) {
      const items = await prisma.stockItem.findMany({ where: { archivedAt: null }, select: { merchantId: true, quantity: true, merchant: merchantBrief } });
      const byMerchant = new Map<string, { merchant: { id: string; shopName: string; phone: string }; items: number; units: number }>();
      for (const i of items) {
        const row = byMerchant.get(i.merchantId) ?? { merchant: i.merchant, items: 0, units: 0 };
        row.items++;
        row.units += i.quantity;
        byMerchant.set(i.merchantId, row);
      }
      res.json([...byMerchant.values()].sort((a, b) => b.units - a.units));
      return;
    }
    const [merchant, items] = await Promise.all([
      prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true, shopName: true, phone: true } }),
      prisma.stockItem.findMany({
        where: { merchantId, archivedAt: null },
        orderBy: { name: "asc" },
        include: { movements: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, kind: true, quantity: true, note: true, by: true, createdAt: true } } },
      }),
    ]);
    if (!merchant) {
      res.status(404).json({ error: "Boutique introuvable" });
      return;
    }
    res.json({ merchant, items });
  });

  // Correction de l'équipe (inventaire, casse) : jamais en dessous de zéro.
  router.post("/logistics/stock/:id/adjust", async (req, res) => {
    const data = parse(adjustInput, req.body, res);
    if (!data) return;
    const where = { id: req.params.id, ...(data.delta < 0 ? { quantity: { gte: -data.delta } } : {}) };
    const { count } = await prisma.stockItem.updateMany({ where, data: { quantity: { increment: data.delta } } });
    if (!count) {
      res.status(409).json({ error: "Stock insuffisant pour cette correction" });
      return;
    }
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: req.params.id } });
    await prisma.stockMovement.create({ data: { stockItemId: item.id, merchantId: item.merchantId, kind: "ADJUST", quantity: data.delta, note: data.note, by: staffName(res) } });
    res.json(item);
  });

  router.patch("/logistics/stock/:id", async (req, res) => {
    const data = parse(itemInput, req.body, res);
    if (!data) return;
    const item = await prisma.stockItem.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!item) {
      res.status(404).json({ error: "Article introuvable" });
      return;
    }
    res.json(item);
  });

  // Colis à préparer à l'entrepôt : articles à sortir pour chaque colis expédié depuis le stock.
  router.get("/logistics/to-prepare", async (_req, res) => {
    const rows = await prisma.order.findMany({
      where: TO_PREPARE,
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, code: true, status: true, recipientName: true, address: true, codAmount: true, createdAt: true, stockLines: true, merchant: merchantBrief, driver: { select: { name: true, phone: true } } },
    });
    res.json(rows.map((o) => ({ ...o, stockLines: parseStockLines(o.stockLines) })));
  });

  router.get("/logistics/returns", async (req, res) => {
    const open = req.query.status !== "closed";
    const rows = await prisma.parcelReturn.findMany({
      where: { status: open ? { in: OPEN_RETURN } : { notIn: OPEN_RETURN } },
      orderBy: { createdAt: open ? "asc" : "desc" },
      take: 200,
      include: {
        merchant: merchantBrief,
        order: { select: { id: true, code: true, status: true, recipientName: true, recipientPhone: true, address: true, codAmount: true, stockLines: true, driver: { select: { name: true, phone: true } } } },
      },
    });
    res.json(rows.map((r) => ({ ...r, reasonLabel: RETURN_REASONS[r.reason as ReturnReason] ?? r.reason, order: { ...r.order, stockLines: parseStockLines(r.order.stockLines) } })));
  });

  // Retour ouvert par l'équipe (code du colis), avec ou sans frais pour le marchand.
  router.post("/logistics/returns", async (req, res) => {
    const data = parse(returnInput, req.body, res);
    if (!data) return;
    const o = await prisma.order.findFirst({
      where: { code: normalizeCode(data.code), merchantId: { not: null }, storeSale: false },
      select: { id: true, code: true, merchantId: true, status: true, pickedUpAt: true, deliveredAt: true },
    });
    if (!o) {
      res.status(404).json({ error: "Aucun colis de marchand avec ce code" });
      return;
    }
    try {
      res.status(201).json(await openReturn(prisma, o, { reason: data.reason, note: data.note, waiveFee: data.waiveFee, requestedBy: "STAFF" }));
    } catch (e) {
      fail(res, e);
    }
  });

  // Avancement d'un retour : arrivé à l'entrepôt, puis remis en stock (colis parti du stock) ou rendu au marchand.
  router.post("/logistics/returns/:id/status", async (req, res) => {
    const data = parse(returnStatusInput, req.body, res);
    if (!data) return;
    const ret = await prisma.parcelReturn.findUnique({ where: { id: req.params.id }, include: { order: { select: { id: true, code: true, merchantId: true, stockLines: true } }, merchant: { select: { shopName: true, customerId: true } } } });
    if (!ret) {
      res.status(404).json({ error: "Retour introuvable" });
      return;
    }
    const allowed: Record<string, string[]> = { TO_COLLECT: ["AT_WAREHOUSE", "HANDED_BACK"], AT_WAREHOUSE: ["RESTOCKED", "HANDED_BACK"] };
    if (!allowed[ret.status]?.includes(data.status)) {
      res.status(409).json({ error: "Ce retour est déjà clôturé" });
      return;
    }
    if (data.status === "RESTOCKED" && !parseStockLines(ret.order.stockLines).length) {
      res.status(409).json({ error: "Ce colis n'est pas parti du stock : rendez-le au marchand" });
      return;
    }
    const now = new Date();
    const by = staffName(res);
    const closing = data.status !== "AT_WAREHOUSE";
    const { count } = await prisma.parcelReturn.updateMany({
      where: { id: ret.id, status: ret.status },
      data: { status: data.status, ...(data.status === "AT_WAREHOUSE" ? { atWarehouseAt: now } : {}), ...(closing ? { closedAt: now, closedBy: by } : {}) },
    });
    if (!count) {
      res.status(409).json({ error: "Ce retour vient de changer : rechargez la page" });
      return;
    }
    if (data.status === "RESTOCKED") await restoreStock(prisma, ret.order, "RETURN", by);
    const label = { AT_WAREHOUSE: "est arrivé à l'entrepôt Zedeka", RESTOCKED: "est remis dans votre stock", HANDED_BACK: "vous a été rendu" }[data.status];
    // Le marchand est prévenu sur son compte client (appli marchand).
    if (ret.merchant.customerId)
      void config.notifier.push("customer", ret.merchant.customerId, { title: `Retour ${ret.order.code}`, body: `Le colis ${ret.order.code} ${label}.`, url: "/marchand/logistique", tag: `return-${ret.id}` }).catch(() => {});
    res.json(await prisma.parcelReturn.findUniqueOrThrow({ where: { id: ret.id } }));
  });

  // Frais logistiques pas encore retenus, par marchand.
  router.get("/logistics/charges", async (_req, res) => {
    const rows = await prisma.logisticsCharge.findMany({ where: { payoutId: null }, orderBy: { createdAt: "asc" }, include: { merchant: merchantBrief } });
    res.json(rows);
  });

  router.patch("/settings/logistics", async (req, res) => {
    const data = parse(settingsInput, req.body, res);
    if (!data) return;
    await getSettings(prisma);
    try {
      const s = await prisma.settings.update({ where: { id: 1 }, data });
      res.json({ warehouseAddress: s.warehouseAddress, warehouseLatitude: s.warehouseLatitude, warehouseLongitude: s.warehouseLongitude, storageFeePerItem: s.storageFeePerItem, returnFee: s.returnFee });
    } catch (e) {
      fail(res, e);
    }
  });

  return router;
}
