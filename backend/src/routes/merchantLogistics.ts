import type { Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CUSTOMER_RETURN_DAYS, chargesDue, openReturn, parseStockLines, RETURN_REASONS, warehouseOf, type ReturnReason } from "../logistics.js";
import type { Notifier } from "../notify.js";
import { normalizeCode } from "../pricing.js";
import { firstError, getSettings } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Appli marchand, « Logistique » : stock à l'entrepôt Zedeka, dépôts de marchandise annoncés, retours de colis et
// frais logistiques. L'expédition depuis le stock passe par l'envoi habituel (POST /parcels, champ stock).

type MerchantLike = { id: string; shopName: string; phone: string; active: boolean };

const depositInput = z.object({
  lines: z
    .array(
      z
        .object({
          stockItemId: z.string().min(1).optional(),
          name: z.string().trim().max(80).default(""),
          sku: z.string().trim().max(40).optional(),
          quantity: z.number().int().min(1, "Quantité d'au moins 1").max(10_000),
          // Marchandise prise dans le stock de la boutique : décomptée de la boutique à la réception.
          fromShop: z.boolean().default(false),
        })
        .refine((l) => l.stockItemId || l.name.length >= 2, { message: "Nommez chaque article" }),
    )
    .min(1, "Ajoutez au moins un article")
    .max(50, "50 articles au plus par dépôt"),
  note: z.string().trim().max(300).optional(),
});

const returnInput = z.object({
  reason: z.enum(["REFUSED", "ABSENT", "DAMAGED", "CUSTOMER_RETURN", "OTHER"]),
  note: z.string().trim().max(300).optional(),
});

export const stockItemSelect = { id: true, name: true, sku: true, quantity: true, shopQuantity: true, price: true, alertAt: true, location: true, updatedAt: true } as const;

export function mountLogisticsRoutes(router: Router, prisma: PrismaClient, notifier: Notifier, merchantOf: (res: Response) => MerchantLike | null) {
  function shop(res: Response, { sending = false } = {}) {
    const m = merchantOf(res);
    if (!m) {
      res.status(404).json({ error: "Créez d'abord votre boutique" });
      return null;
    }
    if (sending && !m.active) {
      res.status(403).json({ error: "Votre boutique est suspendue : contactez Zedeka" });
      return null;
    }
    return m;
  }
  const fail = (res: Response, e: unknown) => {
    if (!(e instanceof HttpError)) throw e;
    res.status(e.status).json({ error: e.message });
  };

  router.get("/logistics", async (_req, res) => {
    const m = shop(res);
    if (!m) return;
    const [settings, items, deposits, returns, charges, history] = await Promise.all([
      getSettings(prisma),
      prisma.stockItem.findMany({ where: { merchantId: m.id, archivedAt: null }, orderBy: { name: "asc" }, select: stockItemSelect }),
      prisma.stockDeposit.findMany({ where: { merchantId: m.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.parcelReturn.findMany({
        where: { merchantId: m.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { order: { select: { code: true, recipientName: true, codAmount: true, stockLines: true } } },
      }),
      chargesDue(prisma, m.id),
      prisma.logisticsCharge.findMany({ where: { merchantId: m.id, payoutId: { not: null } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, kind: true, amount: true, label: true, createdAt: true } }),
    ]);
    const warehouse = warehouseOf(settings);
    res.json({
      warehouse: warehouse && { address: warehouse.address },
      fees: { storagePerItem: settings.storageFeePerItem, returnFee: settings.returnFee },
      items,
      units: items.reduce((s, i) => s + i.quantity, 0),
      deposits: deposits.map((d) => ({ ...d, lines: JSON.parse(d.lines) as unknown })),
      returns: returns.map(({ order, ...r }) => ({ ...r, reasonLabel: RETURN_REASONS[r.reason as ReturnReason] ?? r.reason, code: order.code, recipientName: order.recipientName, fromStock: parseStockLines(order.stockLines).length > 0 })),
      charges: { due: charges.total, open: charges.rows, withheld: history },
    });
  });

  // Dépôt annoncé : la marchandise arrive à l'entrepôt, l'équipe la compte et la met en stock.
  router.post("/logistics/deposits", async (req, res) => {
    const m = shop(res, { sending: true });
    if (!m) return;
    const parsed = depositInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const settings = await getSettings(prisma);
    if (!warehouseOf(settings)) {
      res.status(409).json({ error: "L'entrepôt Zedeka n'est pas encore ouvert" });
      return;
    }
    // Article déjà en stock : on reprend son nom (et on vérifie qu'il est bien à ce marchand).
    const ids = parsed.data.lines.map((l) => l.stockItemId).filter((id): id is string => !!id);
    const known = ids.length ? await prisma.stockItem.findMany({ where: { id: { in: ids }, merchantId: m.id }, select: { id: true, name: true, sku: true } }) : [];
    const lines = [];
    for (const l of parsed.data.lines) {
      const item = l.stockItemId ? known.find((k) => k.id === l.stockItemId) : null;
      if (l.stockItemId && !item) {
        res.status(400).json({ error: "Article introuvable dans votre stock" });
        return;
      }
      lines.push({ stockItemId: item?.id ?? null, name: item?.name ?? l.name, sku: item?.sku ?? (l.sku || null), quantity: l.quantity, fromShop: !!item && l.fromShop });
    }
    const deposit = await prisma.stockDeposit.create({ data: { merchantId: m.id, lines: JSON.stringify(lines), note: parsed.data.note || null } });
    const units = lines.reduce((s, l) => s + l.quantity, 0);
    void notifier.staff("ORDERS", {
      title: `Dépôt annoncé : ${m.shopName}`,
      body: `${units} article(s) à recevoir à l'entrepôt · ${m.phone}`,
      url: "/admin/logistique?onglet=depots",
      tag: `deposit-${deposit.id}`,
    });
    res.status(201).json({ ...deposit, lines });
  });

  router.post("/logistics/deposits/:id/cancel", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const { count } = await prisma.stockDeposit.updateMany({ where: { id: req.params.id, merchantId: m.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (!count) {
      res.status(409).json({ error: "Ce dépôt a déjà été reçu ou annulé" });
      return;
    }
    res.json({ ok: true });
  });

  // Retour demandé par le marchand : colis livré que le client renvoie (14 jours au plus), ou colis en route que le
  // destinataire refuse.
  router.post("/parcels/:code/return", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const parsed = returnInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const o = await prisma.order.findFirst({
      where: { code: normalizeCode(req.params.code), merchantId: m.id, storeSale: false },
      select: { id: true, code: true, merchantId: true, status: true, pickedUpAt: true, deliveredAt: true, recipientName: true },
    });
    if (!o) {
      res.status(404).json({ error: "Colis introuvable" });
      return;
    }
    if (o.status === "DELIVERED" && o.deliveredAt && Date.now() - o.deliveredAt.getTime() > CUSTOMER_RETURN_DAYS * 86_400_000) {
      res.status(409).json({ error: `Retour possible pendant ${CUSTOMER_RETURN_DAYS} jours après la livraison` });
      return;
    }
    if (o.status !== "DELIVERED" && o.status !== "PICKED_UP") {
      res.status(409).json({ error: "Ce colis n'a pas encore été ramassé : annulez-le simplement" });
      return;
    }
    try {
      const ret = await openReturn(prisma, o, { ...parsed.data, requestedBy: "MERCHANT" });
      void notifier.staff("ORDERS", {
        title: `Retour demandé : ${o.code}`,
        body: `${m.shopName} · ${RETURN_REASONS[parsed.data.reason]}${parsed.data.note ? ` · ${parsed.data.note}` : ""}`,
        url: "/admin/logistique?onglet=retours",
        tag: `return-${ret.id}`,
      });
      res.status(201).json(ret);
    } catch (e) {
      fail(res, e);
    }
  });
}
