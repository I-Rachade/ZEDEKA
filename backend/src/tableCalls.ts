import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "./notify.js";
import { isTableToken } from "./tables.js";
import { firstError } from "./util.js";

// Sonnerie de table : le client assis scanne le QR code de sa table et appelle le serveur, demande l'addition ou
// écrit une courte demande. L'espace restaurant sonne (bandeau, alarme, push) jusqu'à ce qu'un membre de l'équipe
// réponde « J'arrive » ; le client le voit sur son téléphone. Sans réponse, la sonnerie est relancée.

export const CALL_KINDS = ["WAITER", "BILL", "OTHER"] as const;
export type CallKind = (typeof CALL_KINDS)[number];
export const CALL_PAYMENTS = ["CASH", "MOBILE_MONEY"] as const;

// Un nouvel appui du client ne fait resonner qu'après 30 s (appuis répétés, enfants qui jouent avec le bouton).
export const CALL_COOLDOWN_MS = 30_000;
// Sans « J'arrive » au bout de 2 min : relance (plus forte) dans l'espace restaurant.
export const CALL_REMIND_MS = 2 * 60_000;
// Un appel oublié se ferme tout seul au bout de 15 min (le client peut sonner à nouveau).
export const CALL_EXPIRE_MS = 15 * 60_000;

const ACTIVE = ["OPEN", "ACK"];

const KIND_LABEL: Record<CallKind, string> = { WAITER: "Appel serveur", BILL: "Addition", OTHER: "Demande" };
const PAYMENT_LABEL: Record<string, string> = { CASH: "espèces", MOBILE_MONEY: "mobile money" };

type CallRow = {
  id: string;
  tableNumber: number;
  kind: string;
  payment: string | null;
  note: string | null;
  status: string;
  rungAt: Date;
  remindedAt: Date | null;
  ackAt: Date | null;
  ackBy: string | null;
  doneAt: Date | null;
  createdAt: Date;
};

// Texte court de l'appel, pour la notification et le bandeau : « Addition (espèces) », « Demande : de l'eau ».
export function callLabel(c: Pick<CallRow, "kind" | "payment" | "note">): string {
  const base = KIND_LABEL[c.kind as CallKind] ?? KIND_LABEL.WAITER;
  if (c.kind === "BILL" && c.payment) return `${base} (${PAYMENT_LABEL[c.payment] ?? c.payment})`;
  if (c.note) return `${base} : ${c.note}`;
  return base;
}

const isLive = (c: Pick<CallRow, "status" | "rungAt">, now: number) => ACTIVE.includes(c.status) && now - c.rungAt.getTime() < CALL_EXPIRE_MS;

// Ce que le client voit : pas le nom complet du serveur, seulement son prénom (rien pour le gérant).
function clientView(c: CallRow | null, now: number) {
  if (!c || !isLive(c, now)) return null;
  return { id: c.id, kind: c.kind, payment: c.payment, note: c.note, status: c.status, rungAt: c.rungAt, ackAt: c.ackAt, ackBy: c.ackBy?.split(" ")[0] ?? null, canRingAgainAt: new Date(c.rungAt.getTime() + CALL_COOLDOWN_MS) };
}

export const callInput = z
  .object({
    kind: z.enum(CALL_KINDS),
    payment: z.enum(CALL_PAYMENTS).nullish(),
    note: z.string().trim().max(120, "120 caractères au maximum").nullish(),
  })
  .transform((v) => ({ kind: v.kind, payment: v.kind === "BILL" ? (v.payment ?? null) : null, note: v.kind === "OTHER" && v.note ? v.note : null }))
  .refine((v) => v.kind !== "OTHER" || Boolean(v.note), { message: "Écrivez votre demande" });

async function tableOf(prisma: PrismaClient, token: string) {
  if (!isTableToken(token)) return null;
  const t = await prisma.restaurantTable.findUnique({
    where: { token },
    select: { id: true, number: true, restaurantId: true, restaurant: { select: { active: true, deletedAt: true, tableCallsEnabled: true } } },
  });
  return t && t.restaurant.active && !t.restaurant.deletedAt ? t : null;
}

const latestActive = (prisma: PrismaClient, tableId: string) =>
  prisma.tableCall.findFirst({ where: { tableId, status: { in: ACTIVE } }, orderBy: { rungAt: "desc" } }) as Promise<CallRow | null>;

function ringRestaurant(notifier: Notifier, restaurantId: string, c: Pick<CallRow, "id" | "tableNumber" | "kind" | "payment" | "note">, again = false) {
  return notifier.push("restaurant", restaurantId, {
    title: `${again ? "Toujours en attente : " : ""}Table ${c.tableNumber}`,
    body: callLabel(c),
    url: "/restaurant/commandes",
    tag: `table-call-${c.id}`,
    alarm: true,
  });
}

// --- Côté client : /api/tables/:token/call (public, le lien du QR code est secret) ---

export function tableCallPublicRouter(prisma: PrismaClient, notifier: Notifier, clock: () => number = Date.now) {
  const router = Router();

  const resolve = async (req: Request, res: Response) => {
    const table = await tableOf(prisma, String(req.params.token));
    if (!table) res.status(404).json({ error: "Table introuvable" });
    return table;
  };

  router.get("/tables/:token/call", async (req, res) => {
    const table = await resolve(req, res);
    if (!table) return;
    res.json({ enabled: table.restaurant.tableCallsEnabled, call: clientView(await latestActive(prisma, table.id), clock()) });
  });

  router.post("/tables/:token/call", async (req, res) => {
    const table = await resolve(req, res);
    if (!table) return;
    if (!table.restaurant.tableCallsEnabled) {
      res.status(409).json({ error: "La sonnerie n'est pas activée dans ce restaurant : faites signe au serveur." });
      return;
    }
    const parsed = callInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const now = clock();
    const current = await latestActive(prisma, table.id);
    // Un seul appel ouvert par table : un nouvel appui met à jour le motif et refait sonner (après 30 s).
    if (current && isLive(current, now)) {
      if (now - current.rungAt.getTime() < CALL_COOLDOWN_MS) {
        res.json({ call: clientView(current, now), rang: false });
        return;
      }
      const updated = (await prisma.tableCall.update({
        where: { id: current.id },
        data: { ...parsed.data, status: "OPEN", rungAt: new Date(now), remindedAt: null, ackAt: null, ackBy: null },
      })) as CallRow;
      await ringRestaurant(notifier, table.restaurantId, updated);
      res.json({ call: clientView(updated, now), rang: true });
      return;
    }
    // Appel oublié (plus de 15 min) : fermé avant d'en ouvrir un nouveau.
    if (current) await prisma.tableCall.update({ where: { id: current.id }, data: { status: "EXPIRED" } });
    const call = (await prisma.tableCall.create({
      data: { ...parsed.data, restaurantId: table.restaurantId, tableId: table.id, tableNumber: table.number, rungAt: new Date(now), createdAt: new Date(now) },
    })) as CallRow;
    await ringRestaurant(notifier, table.restaurantId, call);
    res.status(201).json({ call: clientView(call, now), rang: true });
  });

  // Le client annule (« finalement, c'est bon »).
  router.delete("/tables/:token/call", async (req, res) => {
    const table = await resolve(req, res);
    if (!table) return;
    await prisma.tableCall.updateMany({ where: { tableId: table.id, status: { in: ACTIVE } }, data: { status: "DONE", doneAt: new Date(clock()) } });
    res.status(204).end();
  });

  return router;
}

// --- Côté restaurant : /api/restaurant/table-calls (gérant, manageuse et caissière) ---

export function tableCallPanelRouter(prisma: PrismaClient, restaurantOf: (res: Response) => string, actorName: (res: Response) => string, clock: () => number = Date.now) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const now = clock();
    const since = new Date(now - CALL_EXPIRE_MS);
    const weekAgo = new Date(now - 7 * 86_400_000);
    const [calls, answered] = await Promise.all([
      prisma.tableCall.findMany({ where: { restaurantId: restaurantOf(res), status: { in: ACTIVE }, rungAt: { gte: since } }, orderBy: { rungAt: "asc" } }) as Promise<CallRow[]>,
      prisma.tableCall.findMany({ where: { restaurantId: restaurantOf(res), ackAt: { not: null }, createdAt: { gte: weekAgo } }, select: { rungAt: true, ackAt: true }, take: 500 }),
    ]);
    // Temps moyen de réponse sur 7 jours (de la dernière sonnerie à « J'arrive »).
    const waits = answered.map((c) => c.ackAt!.getTime() - c.rungAt.getTime()).filter((ms) => ms >= 0);
    const avgResponseSec = waits.length ? Math.round(waits.reduce((s, ms) => s + ms, 0) / waits.length / 1000) : null;
    res.json({
      calls: calls.map((c) => ({ id: c.id, tableNumber: c.tableNumber, kind: c.kind, payment: c.payment, note: c.note, status: c.status, label: callLabel(c), rungAt: c.rungAt, ackAt: c.ackAt, ackBy: c.ackBy, reminded: Boolean(c.remindedAt) })),
      stats: { answered: waits.length, avgResponseSec },
    });
  });

  const move = (to: "ACK" | "DONE") => async (req: Request, res: Response) => {
    const now = new Date(clock());
    const from = to === "ACK" ? ["OPEN"] : ACTIVE;
    const data = to === "ACK" ? { status: "ACK", ackAt: now, ackBy: actorName(res) || null } : { status: "DONE", doneAt: now };
    const { count } = await prisma.tableCall.updateMany({ where: { id: String(req.params.id), restaurantId: restaurantOf(res), status: { in: from } }, data });
    if (!count) {
      const exists = await prisma.tableCall.findFirst({ where: { id: String(req.params.id), restaurantId: restaurantOf(res) }, select: { id: true } });
      // Déjà pris par un collègue ou fermé par le client : rien à faire, la liste se met à jour.
      res.status(exists ? 409 : 404).json({ error: exists ? "Cet appel a déjà été pris en charge" : "Appel introuvable" });
      return;
    }
    res.status(204).end();
  };
  router.post("/:id/ack", move("ACK"));
  router.post("/:id/done", move("DONE"));

  return router;
}

// --- Boucle d'une minute (worker.ts) : relance des appels sans réponse, fermeture des appels oubliés ---

export async function remindTableCalls(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const expired = await prisma.tableCall.updateMany({ where: { status: { in: ACTIVE }, rungAt: { lt: new Date(now.getTime() - CALL_EXPIRE_MS) } }, data: { status: "EXPIRED" } });
  const late = (await prisma.tableCall.findMany({
    where: { status: "OPEN", remindedAt: null, rungAt: { lt: new Date(now.getTime() - CALL_REMIND_MS) } },
    select: { id: true, restaurantId: true, tableNumber: true, kind: true, payment: true, note: true },
  })) as (Pick<CallRow, "id" | "tableNumber" | "kind" | "payment" | "note"> & { restaurantId: string })[];
  for (const c of late) {
    // Marqué d'abord : une seule relance même si deux boucles tournent en même temps.
    const { count } = await prisma.tableCall.updateMany({ where: { id: c.id, remindedAt: null, status: "OPEN" }, data: { remindedAt: now } });
    if (count) await ringRestaurant(notifier, c.restaurantId, c, true);
  }
  return { expired: expired.count, reminded: late.length };
}
