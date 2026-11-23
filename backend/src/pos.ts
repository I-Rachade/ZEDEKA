import type { PrismaClient } from "@prisma/client";
import { HttpError } from "./routes/adminWrite.js";
import { isLowStock, mergeLines, recordMovements, type StockLine } from "./logistics.js";

// Caisse (POS) de l'appli marchand : vente au comptoir des articles du stock boutique. Le prix vient de la fiche de
// l'article (jamais de l'écran), le stock boutique est décompté par une écriture conditionnelle (pas de vente au-delà
// du stock), et chaque ticket reçoit le numéro suivant de la boutique. Paiement en espèces (monnaie calculée) ou
// par mobile money (référence notée). Une vente s'annule le jour même : les articles reviennent en boutique.

export const POS_METHODS = ["CASH", "FLOOZ", "TMONEY"] as const;
export type PosMethod = (typeof POS_METHODS)[number];
export type SaleLine = StockLine & { price: number };
export const MAX_SALE_LINES = 50;

// Lomé vit à l'heure UTC : la journée de caisse commence à minuit UTC.
export function dayBounds(day: string | undefined, now = new Date()) {
  const ok = !!day && day.length === 10 && [...day].every((ch, i) => (i === 4 || i === 7 ? ch === "-" : ch >= "0" && ch <= "9"));
  const start = ok ? new Date(`${day}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (Number.isNaN(start.getTime())) return dayBounds(undefined, now);
  return { start, end: new Date(start.getTime() + 86_400_000), key: start.toISOString().slice(0, 10) };
}

// Montants d'une vente : sous-total des lignes, remise plafonnée, total, monnaie à rendre en espèces.
export function saleTotals(lines: { price: number; quantity: number }[], discount: number, method: PosMethod, received?: number | null) {
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  if (discount > subtotal) throw new HttpError(400, "La remise dépasse le montant de la vente");
  const total = subtotal - discount;
  if (method === "CASH" && received != null && received < total) throw new HttpError(400, "Espèces reçues insuffisantes");
  const change = method === "CASH" && received != null ? received - total : 0;
  return { subtotal, total, change };
}

// Totaux d'une journée de caisse, par moyen de paiement (ventes annulées à part).
export function daySummary(sales: { total: number; method: string; cancelledAt: Date | null }[]) {
  const kept = sales.filter((s) => !s.cancelledAt);
  const byMethod = Object.fromEntries(POS_METHODS.map((m) => [m, kept.filter((s) => s.method === m).reduce((t, s) => t + s.total, 0)])) as Record<PosMethod, number>;
  return { count: kept.length, total: kept.reduce((t, s) => t + s.total, 0), byMethod, cancelled: sales.length - kept.length };
}

// Décompte du stock boutique, article par article ; si un article manque, ce qui a été décompté est remis.
export async function takeFromShop(prisma: PrismaClient, merchantId: string, wanted: { stockItemId: string; quantity: number }[]): Promise<SaleLine[]> {
  const lines = mergeLines(wanted);
  const items = await prisma.stockItem.findMany({
    where: { id: { in: lines.map((l) => l.stockItemId) }, merchantId, archivedAt: null },
    select: { id: true, name: true, price: true, shopQuantity: true },
  });
  const done: SaleLine[] = [];
  const undo = async () => {
    for (const d of done) await prisma.stockItem.update({ where: { id: d.stockItemId }, data: { shopQuantity: { increment: d.quantity } } }).catch(() => {});
  };
  for (const l of lines) {
    const item = items.find((i) => i.id === l.stockItemId);
    if (!item) {
      await undo();
      throw new HttpError(400, "Article introuvable dans votre stock");
    }
    if (item.price === null) {
      await undo();
      throw new HttpError(400, `Indiquez d'abord le prix de vente : ${item.name}`);
    }
    const { count } = await prisma.stockItem.updateMany({ where: { id: item.id, merchantId, shopQuantity: { gte: l.quantity } }, data: { shopQuantity: { decrement: l.quantity } } });
    if (!count) {
      await undo();
      throw new HttpError(409, `Stock insuffisant en boutique : ${item.name} (${item.shopQuantity})`);
    }
    done.push({ stockItemId: item.id, name: item.name, quantity: l.quantity, price: item.price });
  }
  return done;
}

export async function createSale(
  prisma: PrismaClient,
  merchantId: string,
  input: {
    lines: { stockItemId: string; quantity: number }[];
    discount: number;
    method: PosMethod;
    received?: number | null;
    reference?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    clientKey?: string | null;
  },
  cashier: string | null,
) {
  // Vente déjà reçue (renvoi après une coupure de réseau) : on rend la même.
  if (input.clientKey) {
    const same = await prisma.posSale.findUnique({ where: { clientKey: input.clientKey } });
    if (same && same.merchantId === merchantId) return { sale: same, lowStock: [] };
  }
  if (input.method !== "CASH" && !input.reference) throw new HttpError(400, "Indiquez la référence du paiement mobile money");
  const lines = await takeFromShop(prisma, merchantId, input.lines);
  let totals;
  try {
    totals = saleTotals(lines, input.discount, input.method, input.received);
  } catch (e) {
    for (const l of lines) await prisma.stockItem.update({ where: { id: l.stockItemId }, data: { shopQuantity: { increment: l.quantity } } });
    throw e;
  }
  let sale;
  for (let attempt = 0; ; attempt++) {
    const last = await prisma.posSale.findFirst({ where: { merchantId }, orderBy: { number: "desc" }, select: { number: true } });
    try {
      sale = await prisma.posSale.create({
        data: {
          merchantId,
          number: (last?.number ?? 0) + 1,
          lines: JSON.stringify(lines),
          subtotal: totals.subtotal,
          discount: input.discount,
          total: totals.total,
          method: input.method,
          received: input.method === "CASH" ? (input.received ?? null) : null,
          reference: input.method === "CASH" ? null : (input.reference ?? null),
          customerName: input.customerName || null,
          customerPhone: input.customerPhone || null,
          cashier,
          clientKey: input.clientKey || null,
        },
      });
      break;
    } catch (e) {
      // Deux ventes au même instant : le numéro de ticket est repris au suivant.
      if ((e as { code?: string }).code !== "P2002" || attempt >= 4) {
        for (const l of lines) await prisma.stockItem.update({ where: { id: l.stockItemId }, data: { shopQuantity: { increment: l.quantity } } });
        throw e;
      }
    }
  }
  await recordMovements(prisma, merchantId, lines, "SALE", { saleId: sale.id, by: cashier });
  const after = await prisma.stockItem.findMany({ where: { id: { in: lines.map((l) => l.stockItemId) } }, select: { id: true, name: true, quantity: true, shopQuantity: true, alertAt: true } });
  return { sale, lowStock: after.filter(isLowStock) };
}

// Annulation le jour même : les articles reviennent en boutique (une seule fois, verrou sur cancelledAt).
export async function cancelSale(prisma: PrismaClient, merchantId: string, saleId: string, by: string | null, now = new Date()) {
  const sale = await prisma.posSale.findFirst({ where: { id: saleId, merchantId } });
  if (!sale) throw new HttpError(404, "Vente introuvable");
  if (sale.createdAt < dayBounds(undefined, now).start) throw new HttpError(409, "Une vente ne s'annule que le jour même");
  const { count } = await prisma.posSale.updateMany({ where: { id: sale.id, cancelledAt: null }, data: { cancelledAt: now } });
  if (!count) throw new HttpError(409, "Cette vente est déjà annulée");
  const lines = JSON.parse(sale.lines) as SaleLine[];
  for (const l of lines) await prisma.stockItem.updateMany({ where: { id: l.stockItemId, merchantId }, data: { shopQuantity: { increment: l.quantity } } });
  await recordMovements(prisma, merchantId, lines, "SALE_CANCEL", { saleId: sale.id, by });
  return { ...sale, cancelledAt: now };
}
