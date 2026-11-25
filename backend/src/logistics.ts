import type { PrismaClient } from "@prisma/client";
import type { Notifier } from "./notify.js";
import { formatFcfa } from "./pricing.js";
import { HttpError } from "./routes/adminWrite.js";
import { getSettings } from "./util.js";

// Logistique pour les e-commerçants (appli marchand, admin « Logistique ») :
//  - Stockage : le marchand dépose sa marchandise à l'entrepôt Zedeka (dépôt annoncé dans l'appli, compté par
//    l'équipe à la réception). Il expédie ensuite ses colis depuis ce stock : le livreur ramasse à l'entrepôt.
//  - Paiement à la livraison : inchangé (contre-remboursement encaissé par le livreur, reversé au marchand).
//  - Retours : colis refusé, absent, abîmé ou renvoyé par le client. Ramené à l'entrepôt, puis remis en stock
//    (colis parti du stock) ou rendu au marchand.
//  - Frais : stockage du mois (par article en stock le 1er du mois suivant) et frais de retour, retenus sur le
//    prochain reversement, dans la limite de ce qui est reversé (le reste attend le reversement suivant).

export type StockLine = { stockItemId: string; name: string; quantity: number };

export const RETURN_REASONS = {
  REFUSED: "Refusé par le destinataire",
  ABSENT: "Destinataire absent ou injoignable",
  DAMAGED: "Colis abîmé",
  CUSTOMER_RETURN: "Renvoyé par le client après livraison",
  CANCELLED_IN_TRANSIT: "Annulé après le ramassage",
  OTHER: "Autre motif",
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;
export const RETURN_STATUSES = ["TO_COLLECT", "AT_WAREHOUSE", "RESTOCKED", "HANDED_BACK"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const OPEN_RETURN: ReturnStatus[] = ["TO_COLLECT", "AT_WAREHOUSE"];

// Un client peut renvoyer un article jusqu'à 14 jours après la livraison.
export const CUSTOMER_RETURN_DAYS = 14;
// Articles différents dans un colis expédié depuis le stock.
export const MAX_STOCK_LINES = 20;

export function parseStockLines(raw: string | null | undefined): StockLine[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((l): l is StockLine => !!l && typeof l.stockItemId === "string" && Number.isInteger(l.quantity) && l.quantity > 0) : [];
  } catch {
    return [];
  }
}

// Mois précédent au format AAAA-MM (Lomé vit à l'heure UTC).
export function previousPeriod(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

// L'entrepôt est ouvert quand son adresse est renseignée dans l'admin.
export function warehouseOf(s: { warehouseAddress: string; warehouseLatitude: number | null; warehouseLongitude: number | null }) {
  const address = s.warehouseAddress.trim();
  return address ? { address, latitude: s.warehouseLatitude, longitude: s.warehouseLongitude } : null;
}

// Regroupe les lignes d'un même article.
export function mergeLines(lines: { stockItemId: string; quantity: number }[]) {
  const out = new Map<string, number>();
  for (const l of lines) out.set(l.stockItemId, (out.get(l.stockItemId) ?? 0) + l.quantity);
  return [...out].map(([stockItemId, quantity]) => ({ stockItemId, quantity }));
}

// Sortie du stock pour un colis : chaque article est décompté seulement s'il en reste assez (écriture conditionnelle,
// deux envois en même temps ne peuvent pas vider le stock deux fois). Si un article manque, ce qui a déjà été
// décompté est remis et l'envoi est refusé.
export async function reserveStock(prisma: PrismaClient, merchantId: string, wanted: { stockItemId: string; quantity: number }[]): Promise<StockLine[]> {
  const lines = mergeLines(wanted);
  const items = await prisma.stockItem.findMany({ where: { id: { in: lines.map((l) => l.stockItemId) }, merchantId, archivedAt: null }, select: { id: true, name: true, quantity: true } });
  const done: StockLine[] = [];
  for (const l of lines) {
    const item = items.find((i) => i.id === l.stockItemId);
    const { count } = item
      ? await prisma.stockItem.updateMany({ where: { id: l.stockItemId, merchantId, archivedAt: null, quantity: { gte: l.quantity } }, data: { quantity: { decrement: l.quantity } } })
      : { count: 0 };
    if (!count) {
      await putBack(prisma, done);
      throw new HttpError(409, item ? `Stock insuffisant : ${item.name} (${item.quantity} en stock)` : "Article introuvable dans votre stock");
    }
    done.push({ stockItemId: l.stockItemId, name: item!.name, quantity: l.quantity });
  }
  return done;
}

async function putBack(prisma: PrismaClient, lines: StockLine[]) {
  for (const l of lines) await prisma.stockItem.update({ where: { id: l.stockItemId }, data: { quantity: { increment: l.quantity } } }).catch(() => {});
}

// Mouvements du stock (historique) : sortie (quantité négative) ou entrée.
export async function recordMovements(
  prisma: PrismaClient,
  merchantId: string,
  lines: StockLine[],
  kind: "SHIPMENT" | "CANCEL" | "RETURN" | "SALE" | "SALE_CANCEL",
  extra: { orderId?: string; saleId?: string; by?: string | null; note?: string } = {},
) {
  if (!lines.length) return;
  const sign = kind === "SHIPMENT" || kind === "SALE" ? -1 : 1;
  const place = kind === "SALE" || kind === "SALE_CANCEL" ? "SHOP" : "WAREHOUSE";
  await prisma.stockMovement.createMany({
    data: lines.map((l) => ({
      stockItemId: l.stockItemId,
      merchantId,
      kind,
      place,
      quantity: sign * l.quantity,
      orderId: extra.orderId ?? null,
      saleId: extra.saleId ?? null,
      by: extra.by ?? null,
      note: extra.note ?? null,
    })),
  });
}

// Remet en stock les articles d'un colis (annulé avant le ramassage, ou retour remis en stock).
export async function restoreStock(prisma: PrismaClient, order: { id: string; merchantId: string | null; stockLines: string | null }, kind: "CANCEL" | "RETURN", by: string | null) {
  const lines = parseStockLines(order.stockLines);
  if (!order.merchantId || !lines.length) return 0;
  // Un article archivé entre-temps reste compté : il revient dans le stock du marchand.
  for (const l of lines) await prisma.stockItem.updateMany({ where: { id: l.stockItemId, merchantId: order.merchantId }, data: { quantity: { increment: l.quantity }, archivedAt: null } });
  await recordMovements(prisma, order.merchantId, lines, kind, { orderId: order.id, by });
  return lines.reduce((s, l) => s + l.quantity, 0);
}

type ReturnOrder = { id: string; code: string; merchantId: string | null; storeSale?: boolean; status: string; pickedUpAt: Date | null; deliveredAt: Date | null; recipientName?: string | null };

// Ouvre le retour d'un colis de marchand et, s'il y a des frais, les ajoute aux frais logistiques du marchand.
export async function openReturn(
  prisma: PrismaClient,
  order: ReturnOrder,
  input: { reason: ReturnReason; note?: string | null; requestedBy: "MERCHANT" | "STAFF" | "AUTO"; waiveFee?: boolean },
) {
  if (!order.merchantId) throw new HttpError(400, "Ce colis n'est pas un colis de marchand");
  if (!order.pickedUpAt && order.status !== "DELIVERED") throw new HttpError(409, "Ce colis n'a pas encore été ramassé : annulez-le simplement");
  if (await prisma.parcelReturn.findUnique({ where: { orderId: order.id }, select: { id: true } })) throw new HttpError(409, "Un retour existe déjà pour ce colis");
  const settings = await getSettings(prisma);
  const fee = input.waiveFee ? 0 : Math.max(0, settings.returnFee);
  // Colis encore chez le livreur (annulé en route) : il le ramène à l'entrepôt ; colis livré : à récupérer chez le client.
  const created = await prisma.parcelReturn.create({
    data: { orderId: order.id, merchantId: order.merchantId, reason: input.reason, note: input.note || null, fee, requestedBy: input.requestedBy },
  });
  if (fee > 0) {
    await prisma.logisticsCharge.create({ data: { merchantId: order.merchantId, kind: "RETURN", amount: fee, label: `Retour du colis ${order.code}`, returnId: created.id } });
  }
  return created;
}

// Colis de marchand annulé par l'équipe : avant le ramassage, ses articles retournent en stock ; après, un retour
// s'ouvre (le livreur ramène le colis à l'entrepôt).
export async function afterMerchantParcelCancelled(
  prisma: PrismaClient,
  notifier: Notifier,
  order: ReturnOrder & { stockLines: string | null },
  by: string | null,
) {
  if (!order.merchantId || order.storeSale) return;
  if (order.pickedUpAt) {
    const ret = await openReturn(prisma, order, { reason: "CANCELLED_IN_TRANSIT", requestedBy: "AUTO" }).catch(() => null);
    if (ret) void notifier.staff("ORDERS", { title: `Retour à ramener : ${order.code}`, body: "Colis annulé après le ramassage : le livreur le ramène à l'entrepôt.", url: "/admin/logistique?onglet=retours", tag: `return-${ret.id}` });
    return;
  }
  await restoreStock(prisma, order, "CANCEL", by);
}

// Frais de stockage du mois écoulé, le 1er du mois : articles en stock × prix par article. Une ligne par marchand et
// par mois (index unique) : relancer le calcul ne facture pas deux fois.
export async function chargeStorage(prisma: PrismaClient, now = new Date()) {
  if (now.getUTCDate() !== 1) return 0;
  const settings = await getSettings(prisma);
  const fee = settings.storageFeePerItem;
  if (fee <= 0) return 0;
  const period = previousPeriod(now);
  const items = await prisma.stockItem.findMany({ where: { archivedAt: null, quantity: { gt: 0 } }, select: { merchantId: true, quantity: true } });
  const units = new Map<string, number>();
  for (const i of items) units.set(i.merchantId, (units.get(i.merchantId) ?? 0) + i.quantity);
  let created = 0;
  for (const [merchantId, n] of units) {
    const exists = await prisma.logisticsCharge.findFirst({ where: { merchantId, kind: "STORAGE", period }, select: { id: true } });
    if (exists) continue;
    try {
      await prisma.logisticsCharge.create({ data: { merchantId, kind: "STORAGE", amount: n * fee, label: `Stockage ${period} : ${n} article(s) × ${formatFcfa(fee)}`, period } });
      created++;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  return created;
}

// Frais pas encore retenus d'un marchand.
export async function chargesDue(prisma: PrismaClient, merchantId: string) {
  const rows = await prisma.logisticsCharge.findMany({ where: { merchantId, payoutId: null }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, amount: true, label: true, createdAt: true } });
  return { total: rows.reduce((s, c) => s + c.amount, 0), rows };
}

// Choisit les frais à retenir sur un reversement : les plus anciens d'abord, tant que leur total ne dépasse pas la
// somme reversée.
export function chargesToWithhold<C extends { id: string; amount: number }>(charges: C[], available: number): C[] {
  const out: C[] = [];
  let left = Math.max(0, available);
  for (const c of charges) {
    if (c.amount > left) break;
    out.push(c);
    left -= c.amount;
  }
  return out;
}

// Rattache les frais retenus au reversement et renvoie leur total.
export async function withholdCharges(prisma: PrismaClient, merchantId: string, payoutId: string, available: number) {
  const { rows } = await chargesDue(prisma, merchantId);
  const picked = chargesToWithhold(rows, available);
  if (!picked.length) return 0;
  await prisma.logisticsCharge.updateMany({ where: { id: { in: picked.map((c) => c.id) }, payoutId: null }, data: { payoutId } });
  const attached = await prisma.logisticsCharge.findMany({ where: { payoutId }, select: { amount: true } });
  return attached.reduce((s, c) => s + c.amount, 0);
}

// Stock bas : articles dont le stock total (boutique + entrepôt) est au seuil d'alerte ou en dessous.
export function isLowStock(i: { quantity: number; shopQuantity: number; alertAt: number | null }) {
  return i.alertAt !== null && i.quantity + i.shopQuantity <= i.alertAt;
}
