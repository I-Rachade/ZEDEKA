import { Router, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HttpError, write } from "./adminWrite.js";
import { staffName } from "../team.js";
import { normalizePhone } from "../customer.js";
import {
  CRM_TYPES,
  CUSTOMER_SEGMENT_RULES,
  NOTE_KINDS,
  SEGMENTS,
  WATCH_BELOW,
  WINDOW_DAYS,
  customerScore,
  driverScore,
  merchantScore,
  restaurantScore,
  scoreColor,
  segmentsFor,
  type CrmType,
  type Score,
  type Segment,
} from "../crm.js";

// Suivi CRM de l'admin : une liste par type (livreurs, clients, commerces, marchands) avec score et groupes, une
// fiche complète par personne (chiffres, historique, détail du score), les notes de l'équipe, les rappels de suivi
// (« Mes suivis ») et des alertes calculées. Ouvert au directeur, à l'adjoint et aux managerins (voir team.ts).

const DAY = 86_400_000;
const who = (res: Response) => staffName(res) ?? "Direction";

type Column = { key: string; label: string };
export type CrmRow = {
  type: CrmType;
  id: string;
  name: string;
  phone: string | null;
  subtitle: string;
  active: boolean;
  createdAt: Date | null;
  lastActivityAt: Date | null;
  score: Score;
  color: ReturnType<typeof scoreColor>;
  segments: Segment[];
  cols: Record<string, string | number>;
  kpis: { label: string; value: string; hint?: string }[];
  // Valeurs brutes utiles aux alertes.
  raw: Record<string, number | null>;
};

const COLUMNS: Record<CrmType, Column[]> = {
  DRIVER: [
    { key: "rating", label: "Note clients" },
    { key: "delivered", label: `Livrées ${WINDOW_DAYS} j` },
    { key: "accept", label: "Acceptées" },
    { key: "complaints", label: "Plaintes" },
  ],
  CUSTOMER: [
    { key: "orders", label: `Commandes ${WINDOW_DAYS} j` },
    { key: "spent", label: "Dépensé" },
    { key: "cancelled", label: "Annulées" },
    { key: "last", label: "Dernière" },
  ],
  RESTAURANT: [
    { key: "rating", label: "Note clients" },
    { key: "received", label: `Commandes ${WINDOW_DAYS} j` },
    { key: "accept", label: "Acceptées" },
    { key: "prep", label: "À l'heure" },
  ],
  MERCHANT: [
    { key: "sent", label: `Colis ${WINDOW_DAYS} j` },
    { key: "done", label: "Livrés" },
    { key: "last30", label: "30 j" },
    { key: "complaints", label: "Plaintes" },
  ],
};

const fmtRating = (avg: number | null, n: number) => (n && avg !== null ? `★ ${avg.toFixed(1).replace(".", ",")} (${n})` : "–");
const fmtPct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "–");
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Africa/Lome" }) : "–");
const fcfa = (n: number) => `${n.toLocaleString("fr-FR").replace(/ | /g, " ")} F`;
const maxDate = (...ds: (Date | null | undefined)[]) => ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function bump<K>(map: Map<K, number>, key: K | null | undefined, by = 1) {
  if (key === null || key === undefined) return;
  map.set(key, (map.get(key) ?? 0) + by);
}

async function warningsByEntity(prisma: PrismaClient, type: CrmType, since: Date, ids?: string[]) {
  const rows = await prisma.crmNote.findMany({
    where: { entityType: type, kind: "WARNING", createdAt: { gte: since }, ...(ids ? { entityId: { in: ids } } : {}) },
    select: { entityId: true },
  });
  const map = new Map<string, number>();
  rows.forEach((r) => bump(map, r.entityId));
  return map;
}

function finish(type: CrmType, base: Omit<CrmRow, "color" | "segments">, extra: { delivered30?: number; delivered60?: number; ordersAllTime?: number } = {}, now = Date.now()): CrmRow {
  return {
    ...base,
    color: scoreColor(base.score.value),
    segments: segmentsFor(type, { score: base.score.value, createdAt: base.createdAt, lastActivityAt: base.lastActivityAt, ...extra }, now),
  };
}

// --- Livreurs ---
async function driverRows(prisma: PrismaClient, ids?: string[]): Promise<CrmRow[]> {
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * DAY);
  const idFilter = ids ? { in: ids } : undefined;
  const [drivers, orders, assignments, complaints, warnings] = await Promise.all([
    prisma.driver.findMany({
      where: { deletedAt: null, status: { not: "REJECTED" }, ...(idFilter ? { id: idFilter } : {}) },
      select: { id: true, name: true, phone: true, active: true, status: true, employment: true, vehicle: true, createdAt: true, lastSeenAt: true, zone: { select: { name: true } } },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: since }, driverId: idFilter ?? { not: null } },
      select: { driverId: true, status: true, driverRating: true, deliveredAt: true, createdAt: true },
    }),
    prisma.driverAssignment.findMany({
      where: { createdAt: { gte: since }, status: { in: ["ACCEPTED", "REJECTED", "EXPIRED"] }, ...(idFilter ? { driverId: idFilter } : {}) },
      select: { driverId: true, status: true },
    }),
    prisma.supportRequest.findMany({
      where: { createdAt: { gte: since }, source: "CUSTOMER", order: { driverId: idFilter ?? { not: null } } },
      select: { order: { select: { driverId: true } } },
    }),
    warningsByEntity(prisma, "DRIVER", since, ids),
  ]);
  const delivered = new Map<string, number>();
  const cancelled = new Map<string, number>();
  const ratings = new Map<string, number[]>();
  const last = new Map<string, Date>();
  for (const o of orders) {
    const id = o.driverId!;
    if (o.status === "DELIVERED") bump(delivered, id);
    if (o.status === "CANCELLED") bump(cancelled, id);
    if (o.driverRating) ratings.set(id, [...(ratings.get(id) ?? []), o.driverRating]);
    const at = o.deliveredAt ?? o.createdAt;
    if (!last.get(id) || at > last.get(id)!) last.set(id, at);
  }
  const offered = new Map<string, number>();
  const accepted = new Map<string, number>();
  for (const a of assignments) {
    bump(offered, a.driverId);
    if (a.status === "ACCEPTED") bump(accepted, a.driverId);
  }
  const compl = new Map<string, number>();
  complaints.forEach((c) => bump(compl, c.order?.driverId));
  return drivers.map((d) => {
    const r = ratings.get(d.id) ?? [];
    const m = {
      ratingAvg: avg(r),
      ratingCount: r.length,
      delivered: delivered.get(d.id) ?? 0,
      cancelled: cancelled.get(d.id) ?? 0,
      offered: offered.get(d.id) ?? 0,
      accepted: accepted.get(d.id) ?? 0,
      complaints: compl.get(d.id) ?? 0,
      warnings: warnings.get(d.id) ?? 0,
    };
    const score = driverScore(m);
    const subtitle = [d.employment === "STAFF" ? "Salarié" : "Indépendant", d.vehicle === "MOTO" ? "moto" : String(d.vehicle).toLowerCase(), d.zone?.name, d.status === "PENDING" ? "candidature" : !d.active ? "suspendu" : null]
      .filter(Boolean)
      .join(" · ");
    return finish(
      "DRIVER",
      {
        type: "DRIVER",
        id: d.id,
        name: d.name,
        phone: d.phone,
        subtitle,
        active: d.active,
        createdAt: d.createdAt,
        lastActivityAt: maxDate(last.get(d.id), d.lastSeenAt),
        score,
        cols: { rating: fmtRating(m.ratingAvg, m.ratingCount), delivered: m.delivered, accept: fmtPct(m.accepted, m.offered), complaints: m.complaints + m.warnings },
        kpis: [
          { label: "Note clients", value: m.ratingCount ? `★ ${m.ratingAvg!.toFixed(1).replace(".", ",")}` : "–", hint: `${m.ratingCount} avis` },
          { label: "Courses livrées", value: String(m.delivered), hint: `${WINDOW_DAYS} derniers jours` },
          { label: "Acceptées", value: fmtPct(m.accepted, m.offered), hint: `${m.offered - m.accepted} refusées ou sans réponse` },
          { label: "Annulées", value: String(m.cancelled), hint: `sur ${m.delivered + m.cancelled} prises` },
          { label: "Plaintes", value: String(m.complaints), hint: `${m.warnings} avertissement${m.warnings > 1 ? "s" : ""}` },
        ],
        raw: { ...m },
      },
      {},
      now,
    );
  });
}

// --- Clients (suivis par numéro : comptes et commandes sans compte) ---
async function customerRows(prisma: PrismaClient, phones?: string[]): Promise<CrmRow[]> {
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * DAY);
  // Les commandes gardent le numéro tel que saisi (« 90 00 00 00 », « +228… ») : regroupées par numéro normalisé.
  const wanted = phones ? new Set(phones) : null;
  const keep = (raw: string | null | undefined) => {
    const p = raw ? normalizePhone(raw) : null;
    return p && (!wanted || wanted.has(p)) ? p : null;
  };
  const orderPhone = phones ? { OR: phones.map((p) => ({ customerPhone: { contains: p.slice(-4) } })) } : {};
  const [accounts, orders, allTime, complaints, warnings] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null, ...(phones ? { phone: { in: phones } } : { phone: { startsWith: "+" } }) },
      select: { id: true, phone: true, name: true, email: true, createdAt: true, lastLoginAt: true },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: since }, ...orderPhone },
      select: { customerPhone: true, customerName: true, status: true, total: true, createdAt: true, deliveredAt: true, pickedUpAt: true, receiptDisputedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.order.groupBy({
      by: ["customerPhone"],
      where: orderPhone,
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.supportRequest.findMany({
      where: { createdAt: { gte: since }, source: { in: ["DRIVER", "RESTAURANT"] }, order: phones ? orderPhone : { isNot: null } },
      select: { order: { select: { customerPhone: true } } },
    }),
    warningsByEntity(prisma, "CUSTOMER", since, phones),
  ]);
  type Acc = { name: string | null; orders: number; delivered: number; cancelled: number; refused: number; disputes: number; spent: number; d30: number; d60: number };
  const stats = new Map<string, Acc>();
  const acc = (p: string) => stats.get(p) ?? (stats.set(p, { name: null, orders: 0, delivered: 0, cancelled: 0, refused: 0, disputes: 0, spent: 0, d30: 0, d60: 0 }), stats.get(p)!);
  for (const o of orders) {
    const phone = keep(o.customerPhone);
    if (!phone) continue;
    const s = acc(phone);
    s.name = o.customerName || s.name;
    s.orders++;
    if (o.status === "DELIVERED") {
      s.delivered++;
      s.spent += o.total;
      const age = (now - o.createdAt.getTime()) / DAY;
      if (age <= 30) s.d30++;
      if (age <= 60) s.d60++;
    }
    if (o.status === "CANCELLED") {
      s.cancelled++;
      if (o.pickedUpAt) s.refused++;
    }
    if (o.receiptDisputedAt) s.disputes++;
  }
  const compl = new Map<string, number>();
  complaints.forEach((c) => bump(compl, keep(c.order?.customerPhone)));
  const ever = new Map<string, { count: number; first: Date | null; last: Date | null }>();
  for (const g of allTime) {
    const phone = keep(g.customerPhone);
    if (!phone) continue;
    const e = ever.get(phone) ?? { count: 0, first: null, last: null };
    e.count += g._count._all;
    if (g._min.createdAt && (!e.first || g._min.createdAt < e.first)) e.first = g._min.createdAt;
    e.last = maxDate(e.last, g._max.createdAt);
    ever.set(phone, e);
  }
  const byPhone = new Map(accounts.map((a) => [a.phone, a]));
  const all = new Set<string>([...byPhone.keys(), ...ever.keys()]);
  const rows: CrmRow[] = [];
  for (const phone of all) {
    if (!phone || !phone.startsWith("+228")) continue;
    const a = byPhone.get(phone);
    const g = ever.get(phone);
    const s = stats.get(phone) ?? acc(phone);
    const m = { orders: s.orders, delivered: s.delivered, cancelled: s.cancelled, refusedAtDoor: s.refused, disputes: s.disputes, complaints: compl.get(phone) ?? 0, warnings: warnings.get(phone) ?? 0 };
    const score = customerScore(m);
    const lastOrder = g?.last ?? null;
    const firstOrder = g?.first ?? null;
    const total = g?.count ?? 0;
    rows.push(
      finish(
        "CUSTOMER",
        {
          type: "CUSTOMER",
          id: phone,
          name: a?.name || s.name || "Client",
          phone,
          subtitle: [a ? "compte client" : "sans compte", a?.email, `${total} commande${total > 1 ? "s" : ""} en tout`].filter(Boolean).join(" · "),
          active: true,
          // Client « nouveau » : depuis sa première commande (ou l'ouverture du compte s'il n'a pas encore commandé).
          createdAt: firstOrder ?? a?.createdAt ?? null,
          lastActivityAt: maxDate(lastOrder, a?.lastLoginAt),
          score,
          cols: { orders: s.orders, spent: fcfa(s.spent), cancelled: s.cancelled, last: fmtDate(lastOrder) },
          kpis: [
            { label: "Commandes", value: String(s.orders), hint: `${WINDOW_DAYS} derniers jours (${total} en tout)` },
            { label: "Livrées", value: String(s.delivered), hint: fcfa(s.spent) },
            { label: "Annulées", value: String(s.cancelled), hint: `${s.refused} refusée${s.refused > 1 ? "s" : ""} à la porte` },
            { label: "Litiges", value: String(s.disputes), hint: "« pas reçu »" },
            { label: "Plaintes", value: String(m.complaints), hint: `${m.warnings} avertissement${m.warnings > 1 ? "s" : ""}` },
          ],
          raw: { ...m, spent: s.spent, d30: s.d30, d60: s.d60, total },
        },
        { delivered30: s.d30, delivered60: s.d60, ordersAllTime: total },
        now,
      ),
    );
  }
  return rows;
}

// --- Commerces (restaurants et boutiques) ---
async function restaurantRows(prisma: PrismaClient, ids?: string[]): Promise<CrmRow[]> {
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * DAY);
  const idFilter = ids ? { in: ids } : undefined;
  const [restaurants, orders, complaints, warnings] = await Promise.all([
    prisma.restaurant.findMany({
      where: { deletedAt: null, ...(idFilter ? { id: idFilter } : {}) },
      select: { id: true, name: true, phone: true, kind: true, active: true, createdAt: true, address: true, zone: { select: { name: true } } },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: since }, restaurantId: idFilter ?? { not: null } },
      select: { restaurantId: true, status: true, restaurantRating: true, confirmedAt: true, readyAt: true, prepMinutes: true, createdAt: true },
    }),
    prisma.supportRequest.findMany({ where: { createdAt: { gte: since }, restaurantId: idFilter ?? { not: null } }, select: { restaurantId: true } }),
    warningsByEntity(prisma, "RESTAURANT", since, ids),
  ]);
  type Acc = { ratings: number[]; received: number; refused: number; delivered: number; timed: number; onTime: number; last: Date | null };
  const stats = new Map<string, Acc>();
  for (const o of orders) {
    const id = o.restaurantId!;
    const s = stats.get(id) ?? (stats.set(id, { ratings: [], received: 0, refused: 0, delivered: 0, timed: 0, onTime: 0, last: null }), stats.get(id)!);
    s.received++;
    if (o.status === "CANCELLED" && !o.confirmedAt) s.refused++;
    if (o.status === "DELIVERED") s.delivered++;
    if (o.restaurantRating) s.ratings.push(o.restaurantRating);
    if (o.confirmedAt && o.readyAt && o.prepMinutes) {
      s.timed++;
      if ((o.readyAt.getTime() - o.confirmedAt.getTime()) / 60_000 <= o.prepMinutes + 10) s.onTime++;
    }
    if (!s.last || o.createdAt > s.last) s.last = o.createdAt;
  }
  const compl = new Map<string, number>();
  complaints.forEach((c) => bump(compl, c.restaurantId));
  return restaurants.map((r) => {
    const s = stats.get(r.id) ?? { ratings: [], received: 0, refused: 0, delivered: 0, timed: 0, onTime: 0, last: null };
    const m = { ratingAvg: avg(s.ratings), ratingCount: s.ratings.length, received: s.received, refused: s.refused, delivered: s.delivered, timed: s.timed, onTime: s.onTime, complaints: compl.get(r.id) ?? 0, warnings: warnings.get(r.id) ?? 0 };
    return finish(
      "RESTAURANT",
      {
        type: "RESTAURANT",
        id: r.id,
        name: r.name,
        phone: r.phone,
        subtitle: [r.kind === "SHOP" ? "Boutique" : "Restaurant", r.zone?.name, r.active ? null : "désactivé"].filter(Boolean).join(" · "),
        active: r.active,
        createdAt: r.createdAt,
        lastActivityAt: s.last,
        score: restaurantScore(m),
        cols: { rating: fmtRating(m.ratingAvg, m.ratingCount), received: s.received, accept: fmtPct(s.received - s.refused, s.received), prep: fmtPct(s.onTime, s.timed) },
        kpis: [
          { label: "Note clients", value: m.ratingCount ? `★ ${m.ratingAvg!.toFixed(1).replace(".", ",")}` : "–", hint: `${m.ratingCount} avis` },
          { label: "Commandes", value: String(s.received), hint: `${s.delivered} livrées` },
          { label: "Acceptées", value: fmtPct(s.received - s.refused, s.received), hint: `${s.refused} refusée${s.refused > 1 ? "s" : ""} ou sans réponse` },
          { label: "Prêtes à l'heure", value: fmtPct(s.onTime, s.timed), hint: `${s.timed} mesurées` },
          { label: "Plaintes", value: String(m.complaints), hint: `${m.warnings} avertissement${m.warnings > 1 ? "s" : ""}` },
        ],
        raw: { ...m },
      },
      {},
      now,
    );
  });
}

// --- Marchands (colis e-commerce) ---
async function merchantRows(prisma: PrismaClient, ids?: string[]): Promise<CrmRow[]> {
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * DAY);
  const idFilter = ids ? { in: ids } : undefined;
  const [merchants, orders, warnings] = await Promise.all([
    prisma.merchant.findMany({
      where: idFilter ? { id: idFilter } : {},
      select: { id: true, shopName: true, phone: true, active: true, createdAt: true, storeStatus: true, customer: { select: { name: true } } },
    }),
    prisma.order.findMany({ where: { createdAt: { gte: since }, merchantId: idFilter ?? { not: null } }, select: { merchantId: true, status: true, createdAt: true } }),
    warningsByEntity(prisma, "MERCHANT", since, ids),
  ]);
  type Acc = { sent: number; delivered: number; cancelled: number; last30: number; last: Date | null };
  const stats = new Map<string, Acc>();
  for (const o of orders) {
    const s = stats.get(o.merchantId!) ?? (stats.set(o.merchantId!, { sent: 0, delivered: 0, cancelled: 0, last30: 0, last: null }), stats.get(o.merchantId!)!);
    s.sent++;
    if (o.status === "DELIVERED") s.delivered++;
    if (o.status === "CANCELLED") s.cancelled++;
    if (now - o.createdAt.getTime() <= 30 * DAY) s.last30++;
    if (!s.last || o.createdAt > s.last) s.last = o.createdAt;
  }
  return merchants.map((mc) => {
    const s = stats.get(mc.id) ?? { sent: 0, delivered: 0, cancelled: 0, last30: 0, last: null };
    const m = { sent: s.sent, delivered: s.delivered, cancelled: s.cancelled, sentLast30: s.last30, complaints: 0, warnings: warnings.get(mc.id) ?? 0 };
    return finish(
      "MERCHANT",
      {
        type: "MERCHANT",
        id: mc.id,
        name: mc.shopName,
        phone: mc.phone,
        subtitle: [mc.customer?.name, mc.storeStatus === "ONLINE" ? "boutique en ligne" : null, mc.active ? null : "suspendu"].filter(Boolean).join(" · "),
        active: mc.active,
        createdAt: mc.createdAt,
        lastActivityAt: s.last,
        score: merchantScore(m),
        cols: { sent: s.sent, done: fmtPct(s.delivered, s.delivered + s.cancelled), last30: s.last30, complaints: m.warnings },
        kpis: [
          { label: "Colis envoyés", value: String(s.sent), hint: `${WINDOW_DAYS} derniers jours` },
          { label: "Livrés", value: String(s.delivered), hint: fmtPct(s.delivered, s.delivered + s.cancelled) },
          { label: "Annulés", value: String(s.cancelled) },
          { label: "Envois 30 j", value: String(s.last30) },
          { label: "Avertissements", value: String(m.warnings) },
        ],
        raw: { ...m },
      },
      {},
      now,
    );
  });
}

export function loadRows(prisma: PrismaClient, type: CrmType, ids?: string[]) {
  if (type === "DRIVER") return driverRows(prisma, ids);
  if (type === "CUSTOMER") return customerRows(prisma, ids);
  if (type === "RESTAURANT") return restaurantRows(prisma, ids);
  return merchantRows(prisma, ids);
}

// Historique d'une personne : commandes, notes, refus, incidents, demandes et notes de l'équipe, du plus récent.
type Event = { at: Date; icon: string; text: string; orderId?: string; code?: string; author?: string };

const STATUS_FR: Record<string, string> = {
  PENDING: "reçue",
  CONFIRMED: "acceptée",
  PREPARING: "en préparation",
  READY: "prête",
  PICKED_UP: "en route",
  DELIVERED: "livrée",
  CANCELLED: "annulée",
};
const NOTE_ICON: Record<string, string> = { NOTE: "📝", CALL: "☎️", WARNING: "⚠️", PRAISE: "🎉" };
const NOTE_LABEL: Record<string, string> = { NOTE: "Note", CALL: "Appel", WARNING: "Avertissement", PRAISE: "Félicitations" };

function orderEvent(o: { id: string; code: string; status: string; createdAt: Date; deliveredAt: Date | null; cancelledAt: Date | null; cancellationReason: string | null; ratingComment: string | null }, rating: number | null, who: string): Event {
  const at = o.deliveredAt ?? o.cancelledAt ?? o.createdAt;
  const parts = [`Commande ${STATUS_FR[o.status] ?? o.status}`];
  if (o.status === "CANCELLED" && o.cancellationReason) parts.push(`(${o.cancellationReason})`);
  if (rating) parts.push(`· notée ${rating}/5 ${who}`);
  if (rating && o.ratingComment) parts.push(`: « ${o.ratingComment} »`);
  const icon = o.status === "CANCELLED" ? "🚫" : rating && rating <= 2 ? "👎" : rating ? "⭐" : o.status === "DELIVERED" ? "✅" : "🧾";
  return { at, icon, text: parts.join(" "), orderId: o.id, code: o.code };
}

const ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  createdAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancellationReason: true,
  ratingComment: true,
  driverRating: true,
  restaurantRating: true,
} satisfies Prisma.OrderSelect;

async function timeline(prisma: PrismaClient, type: CrmType, id: string): Promise<Event[]> {
  const events: Event[] = [];
  const notes = await prisma.crmNote.findMany({ where: { entityType: type, entityId: id }, orderBy: { createdAt: "desc" }, take: 50 });
  notes.forEach((n) => events.push({ at: n.createdAt, icon: NOTE_ICON[n.kind] ?? "📝", text: `${NOTE_LABEL[n.kind] ?? "Note"} : ${n.body}`, author: n.author }));
  const done = await prisma.crmTask.findMany({ where: { entityType: type, entityId: id, doneAt: { not: null } }, orderBy: { doneAt: "desc" }, take: 20 });
  done.forEach((t) => events.push({ at: t.doneAt!, icon: "☑️", text: `Suivi fait : ${t.title}`, author: t.doneBy ?? undefined }));

  if (type === "DRIVER") {
    const [orders, refusals, issues, requests] = await Promise.all([
      prisma.order.findMany({ where: { driverId: id }, orderBy: { createdAt: "desc" }, take: 40, select: ORDER_SELECT }),
      prisma.driverAssignment.findMany({ where: { driverId: id, status: { in: ["REJECTED", "EXPIRED"] } }, orderBy: { createdAt: "desc" }, take: 25, select: { createdAt: true, respondedAt: true, status: true, reason: true, order: { select: { id: true, code: true } } } }),
      prisma.driverIssue.findMany({ where: { driverId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, kind: true, note: true, order: { select: { id: true, code: true } } } }),
      prisma.supportRequest.findMany({ where: { order: { driverId: id } }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, subject: true, status: true, source: true, order: { select: { id: true, code: true } } } }),
    ]);
    orders.forEach((o) => events.push(orderEvent(o, o.driverRating, "par le client")));
    refusals.forEach((a) =>
      events.push({ at: a.respondedAt ?? a.createdAt, icon: "↩️", text: a.status === "EXPIRED" ? "Course laissée sans réponse" : `A refusé la course${a.reason ? ` (« ${a.reason} »)` : ""}`, orderId: a.order.id, code: a.order.code }),
    );
    issues.forEach((i) => events.push({ at: i.createdAt, icon: "🛵", text: `Problème signalé par lui : ${i.kind}${i.note ? ` – ${i.note}` : ""}`, orderId: i.order?.id, code: i.order?.code }));
    requests.forEach((r) => events.push({ at: r.createdAt, icon: "📞", text: `Demande (${r.source === "CUSTOMER" ? "plainte client" : "équipe"}) : ${r.subject} – ${r.status === "DONE" ? "close" : "ouverte"}`, orderId: r.order?.id, code: r.order?.code }));
  } else if (type === "CUSTOMER") {
    const tail = id.slice(-4);
    const same = (raw: string | null | undefined) => !!raw && normalizePhone(raw) === id;
    const [orders, requests] = await Promise.all([
      prisma.order.findMany({ where: { customerPhone: { contains: tail } }, orderBy: { createdAt: "desc" }, take: 200, select: { ...ORDER_SELECT, customerPhone: true, receiptDisputedAt: true, receiptDisputeNote: true, total: true } }),
      prisma.supportRequest.findMany({
        where: { OR: [{ contactPhone: { contains: tail } }, { order: { customerPhone: { contains: tail } } }] },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { createdAt: true, subject: true, status: true, source: true, contactPhone: true, order: { select: { id: true, code: true, customerPhone: true } } } }),
    ]).then(([o, r]) => [
      o.filter((x) => same(x.customerPhone)).slice(0, 40),
      r.filter((x) => same(x.contactPhone) || same(x.order?.customerPhone)).slice(0, 20),
    ] as const);
    for (const o of orders) {
      const e = orderEvent(o, o.driverRating, "le livreur, par lui");
      e.text = `${e.text.replace(/ · notée.*$/, "")} · ${fcfa(o.total)}${o.driverRating ? ` · a noté le livreur ${o.driverRating}/5` : ""}`;
      events.push(e);
      if (o.receiptDisputedAt) events.push({ at: o.receiptDisputedAt, icon: "❗", text: `Dit ne pas avoir reçu${o.receiptDisputeNote ? ` : ${o.receiptDisputeNote}` : ""}`, orderId: o.id, code: o.code });
    }
    requests.forEach((r) => events.push({ at: r.createdAt, icon: "📞", text: `Demande (${r.source === "CUSTOMER" ? "du client" : r.source === "DRIVER" ? "d'un livreur" : r.source === "RESTAURANT" ? "d'un commerce" : "autre"}) : ${r.subject} – ${r.status === "DONE" ? "close" : "ouverte"}`, orderId: r.order?.id, code: r.order?.code }));
  } else if (type === "RESTAURANT") {
    const [orders, requests] = await Promise.all([
      prisma.order.findMany({ where: { restaurantId: id }, orderBy: { createdAt: "desc" }, take: 40, select: ORDER_SELECT }),
      prisma.supportRequest.findMany({ where: { restaurantId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, subject: true, status: true, order: { select: { id: true, code: true } } } }),
    ]);
    orders.forEach((o) => events.push(orderEvent(o, o.restaurantRating, "par le client")));
    requests.forEach((r) => events.push({ at: r.createdAt, icon: "📞", text: `Demande : ${r.subject} – ${r.status === "DONE" ? "close" : "ouverte"}`, orderId: r.order?.id, code: r.order?.code }));
  } else {
    const orders = await prisma.order.findMany({ where: { merchantId: id }, orderBy: { createdAt: "desc" }, take: 40, select: ORDER_SELECT });
    orders.forEach((o) => events.push(orderEvent(o, null, "")));
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 80);
}

const typeParam = (raw: string): CrmType | null => {
  const up = raw.toUpperCase();
  return (CRM_TYPES as readonly string[]).includes(up) ? (up as CrmType) : null;
};

const noteInput = z.object({ kind: z.enum(NOTE_KINDS).default("NOTE"), body: z.string().trim().min(1, "Note vide").max(2000) });
const tagInput = z.object({ label: z.string().trim().min(2, "Étiquette : 2 caractères minimum").max(40) });
const taskInput = z.object({
  title: z.string().trim().min(3, "Suivi : 3 caractères minimum").max(200),
  dueAt: z.coerce.date(),
  assignedTo: z.string().trim().max(80).optional().nullable(),
});

function publicRow(r: CrmRow) {
  const { raw: _raw, kpis: _kpis, ...rest } = r;
  return { ...rest, score: r.score.value };
}

export function adminCrmRouter(prisma: PrismaClient) {
  const router = Router();

  // Noms de l'équipe, pour choisir à qui confier un rappel.
  router.get("/crm/team", async (_req, res) => {
    const members = await prisma.teamMember.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } });
    res.json(members.map((m) => m.name));
  });

  // Rappels ouverts : ?mine=1 pour les miens (et ceux de toute l'équipe), sinon tous.
  router.get("/crm/tasks", async (req, res) => {
    const me = who(res);
    const where: Prisma.CrmTaskWhereInput = { doneAt: null };
    if (req.query.mine === "1") where.OR = [{ assignedTo: me }, { assignedTo: null }];
    res.json(await prisma.crmTask.findMany({ where, orderBy: { dueAt: "asc" }, take: 300 }));
  });

  router.patch(
    "/crm/tasks/:id",
    write(
      z.object({ done: z.boolean(), dueAt: z.coerce.date(), assignedTo: z.string().trim().max(80).nullable() }),
      async ({ done, ...data }, id, res) => {
        if (!(await prisma.crmTask.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, "Suivi introuvable");
        const update: Prisma.CrmTaskUpdateInput = { ...data };
        if (done === true) Object.assign(update, { doneAt: new Date(), doneBy: who(res) });
        if (done === false) Object.assign(update, { doneAt: null, doneBy: null });
        return prisma.crmTask.update({ where: { id }, data: update });
      },
      { partial: true },
    ),
  );

  // Alertes calculées à la lecture : rien n'est envoyé, l'équipe les voit sur « Mes suivis ».
  router.get("/crm/alerts", async (_req, res) => {
    const since7 = new Date(Date.now() - 7 * DAY);
    const since30 = new Date(Date.now() - 30 * DAY);
    const [drivers, restaurants, merchants, customers, badRatings, praised] = await Promise.all([
      loadRows(prisma, "DRIVER"),
      loadRows(prisma, "RESTAURANT"),
      loadRows(prisma, "MERCHANT"),
      loadRows(prisma, "CUSTOMER"),
      prisma.order.findMany({ where: { ratedAt: { gte: since7 }, restaurantRating: { lte: 2 }, restaurantId: { not: null } }, select: { restaurantId: true } }),
      prisma.crmNote.findMany({ where: { entityType: "DRIVER", kind: "PRAISE", createdAt: { gte: since30 } }, select: { entityId: true } }),
    ]);
    type Alert = { kind: "WATCH" | "BAD_RATINGS" | "PRAISE" | "DOOR" | "DORMANT"; type: CrmType; id?: string; name: string; text: string };
    const alerts: Alert[] = [];
    for (const d of drivers) {
      if (d.active && d.score.value !== null && d.score.value < WATCH_BELOW) alerts.push({ kind: "WATCH", type: "DRIVER", id: d.id, name: d.name, text: `score ${d.score.value} sur 100` });
    }
    const praisedIds = new Set(praised.map((p) => p.entityId));
    for (const d of drivers) {
      if (d.active && (d.raw.ratingCount ?? 0) >= 20 && (d.raw.ratingAvg ?? 0) >= 4.7 && !praisedIds.has(d.id)) {
        alerts.push({ kind: "PRAISE", type: "DRIVER", id: d.id, name: d.name, text: `★ ${d.raw.ratingAvg!.toFixed(1).replace(".", ",")} sur ${d.raw.ratingCount} avis : à féliciter` });
      }
    }
    const bad = new Map<string, number>();
    badRatings.forEach((o) => bump(bad, o.restaurantId));
    for (const r of restaurants) {
      const n = bad.get(r.id) ?? 0;
      if (n >= 3) alerts.push({ kind: "BAD_RATINGS", type: "RESTAURANT", id: r.id, name: r.name, text: `${n} notes de 2 ou moins en 7 jours` });
      else if (r.active && r.score.value !== null && r.score.value < WATCH_BELOW) alerts.push({ kind: "WATCH", type: "RESTAURANT", id: r.id, name: r.name, text: `score ${r.score.value} sur 100` });
    }
    for (const m of merchants) {
      if (m.active && m.score.value !== null && m.score.value < WATCH_BELOW) alerts.push({ kind: "WATCH", type: "MERCHANT", id: m.id, name: m.name, text: `score ${m.score.value} sur 100` });
    }
    for (const c of customers) {
      if ((c.raw.refusedAtDoor ?? 0) >= 2) alerts.push({ kind: "DOOR", type: "CUSTOMER", id: c.id, name: c.name, text: `${c.raw.refusedAtDoor} commandes refusées à la porte` });
    }
    const dormant = customers.filter((c) => c.segments.includes("DORMANT")).length;
    if (dormant) alerts.push({ kind: "DORMANT", type: "CUSTOMER", name: `${dormant} client${dormant > 1 ? "s" : ""}`, text: "fidèles qui n'ont plus commandé depuis 21 jours" });
    res.json(alerts);
  });

  // Groupes de clients et leur taille.
  router.get("/crm/segments", async (_req, res) => {
    const customers = await loadRows(prisma, "CUSTOMER");
    res.json(
      (Object.keys(CUSTOMER_SEGMENT_RULES) as Segment[]).map((key) => ({ key, label: SEGMENTS[key], rule: CUSTOMER_SEGMENT_RULES[key], count: customers.filter((c) => c.segments.includes(key)).length })),
    );
  });

  // Liste d'un type : ?q= (nom ou numéro), ?segment= (WATCH, TOP, NEW, INACTIVE, VIP, LOYAL, DORMANT, TODO).
  router.get("/crm/:type", async (req, res) => {
    const type = typeParam(req.params.type);
    if (!type) {
      res.status(404).json({ error: "Type inconnu" });
      return;
    }
    const [rows, tags, tasks] = await Promise.all([
      loadRows(prisma, type),
      prisma.crmTag.findMany({ where: { entityType: type }, select: { entityId: true, label: true } }),
      prisma.crmTask.findMany({ where: { entityType: type, doneAt: null }, orderBy: { dueAt: "asc" }, select: { entityId: true, title: true, dueAt: true, assignedTo: true } }),
    ]);
    const tagsOf = new Map<string, string[]>();
    tags.forEach((t) => tagsOf.set(t.entityId, [...(tagsOf.get(t.entityId) ?? []), t.label]));
    const taskOf = new Map<string, (typeof tasks)[number]>();
    tasks.forEach((t) => taskOf.has(t.entityId) || taskOf.set(t.entityId, t));

    const counts: Record<string, number> = { ALL: rows.length, TODO: rows.filter((r) => taskOf.has(r.id)).length };
    for (const key of Object.keys(SEGMENTS)) counts[key] = rows.filter((r) => r.segments.includes(key as Segment)).length;

    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const digits = q.replace(/\D/g, "");
    const segment = String(req.query.segment ?? "");
    let list = rows.filter((r) => {
      if (q && !(r.name.toLowerCase().includes(q) || (digits.length >= 3 && (r.phone ?? "").replace(/\D/g, "").includes(digits)) || (tagsOf.get(r.id) ?? []).some((t) => t.toLowerCase().includes(q)))) return false;
      if (segment === "TODO") return taskOf.has(r.id);
      if (segment && segment !== "ALL") return r.segments.includes(segment as Segment);
      return true;
    });
    // À surveiller d'abord (score le plus bas), sinon les plus actifs (score le plus haut, sans score à la fin).
    list = list.sort((a, b) => {
      const sa = a.score.value ?? -1;
      const sb = b.score.value ?? -1;
      if (segment === "WATCH") return sa - sb;
      if (sa !== sb) return sb - sa;
      return (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0);
    });
    const limit = Math.min(Number(req.query.limit) || 300, 5000);
    res.json({
      columns: COLUMNS[type],
      counts,
      total: list.length,
      rows: list.slice(0, limit).map((r) => ({ ...publicRow(r), tags: tagsOf.get(r.id) ?? [], nextTask: taskOf.get(r.id) ?? null })),
    });
  });

  // Fiche complète d'une personne.
  router.get("/crm/:type/:id", async (req, res) => {
    const type = typeParam(req.params.type);
    const id = type === "CUSTOMER" ? (normalizePhone(req.params.id) ?? req.params.id) : req.params.id;
    const [row] = type ? await loadRows(prisma, type, [id]) : [];
    if (!type || !row) {
      res.status(404).json({ error: "Personne introuvable" });
      return;
    }
    const [events, tags, tasks] = await Promise.all([
      timeline(prisma, type, id),
      prisma.crmTag.findMany({ where: { entityType: type, entityId: id }, orderBy: { createdAt: "asc" } }),
      prisma.crmTask.findMany({ where: { entityType: type, entityId: id, doneAt: null }, orderBy: { dueAt: "asc" } }),
    ]);
    const { raw: _raw, ...rest } = row;
    res.json({ ...rest, columns: COLUMNS[type], tags, tasks, timeline: events, windowDays: WINDOW_DAYS });
  });

  const entityName = async (type: CrmType, id: string) => (await loadRows(prisma, type, [id]))[0]?.name ?? null;
  const entityOr404 = async (req: { params: Record<string, string> }) => {
    const type = typeParam(req.params.type);
    const id = type === "CUSTOMER" ? (normalizePhone(req.params.entityId) ?? req.params.entityId) : req.params.entityId;
    const name = type ? await entityName(type, id) : null;
    if (!type || !name) throw new HttpError(404, "Personne introuvable");
    return { type, id, name };
  };

  router.post("/crm/:type/:entityId/notes", (req, res) =>
    write(noteInput, async ({ kind, body }) => {
      const e = await entityOr404(req);
      return prisma.crmNote.create({ data: { entityType: e.type, entityId: e.id, kind, body, author: who(res) } });
    })(req, res),
  );

  router.post("/crm/:type/:entityId/tags", (req, res) =>
    write(tagInput, async ({ label }) => {
      const e = await entityOr404(req);
      const existing = await prisma.crmTag.findFirst({ where: { entityType: e.type, entityId: e.id, label } });
      return existing ?? prisma.crmTag.create({ data: { entityType: e.type, entityId: e.id, label, createdBy: who(res) } });
    })(req, res),
  );

  router.delete("/crm/:type/:entityId/tags/:tagId", async (req, res) => {
    const type = typeParam(req.params.type);
    const { count } = await prisma.crmTag.deleteMany({ where: { id: req.params.tagId, entityType: type ?? "", entityId: req.params.entityId } });
    if (!count) {
      res.status(404).json({ error: "Étiquette introuvable" });
      return;
    }
    res.status(204).end();
  });

  router.post("/crm/:type/:entityId/tasks", (req, res) =>
    write(taskInput, async ({ title, dueAt, assignedTo }) => {
      const e = await entityOr404(req);
      return prisma.crmTask.create({ data: { entityType: e.type, entityId: e.id, entityName: e.name, title, dueAt, assignedTo: assignedTo || null, createdBy: who(res) } });
    })(req, res),
  );

  return router;
}
