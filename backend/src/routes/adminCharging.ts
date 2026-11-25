import { Router, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { book, dayStart, minutesOf, SERVICES } from "../charging.js";
import { staffName } from "../team.js";
import { firstError, patchOf } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Admin « Recharge » : stations (bornes, échange de batteries, prix, horaires), réservations et passages du jour,
// arrivée, paiement et fin de séance, et chiffres (séances, motos hors Zedeka, encaissé).

const time = z.string().refine((v) => minutesOf(v) !== null, "Heure invalide (HH:MM)");
const stationInput = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["CHARGE", "SWAP", "BOTH"]),
  address: z.string().trim().min(3).max(300),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  chargePoints: z.number().int().min(0).max(100),
  swapBays: z.number().int().min(0).max(100),
  chargePrice: z.number().int().min(0).max(100_000),
  swapPrice: z.number().int().min(0).max(100_000),
  slotMinutes: z.number().int().min(15).max(240),
  opensAt: time,
  closesAt: time,
  active: z.boolean(),
  note: z.string().trim().max(300).nullish(),
});
const walkInInput = z.object({
  stationId: z.string().min(1),
  service: z.enum(SERVICES),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(20),
  plate: z.string().trim().min(3).max(20),
  bikeModel: z.string().trim().max(60).optional(),
});
const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CHECK_IN") }),
  z.object({
    action: z.literal("DONE"),
    paymentMethod: z.enum(["CASH", "FLOOZ", "TMONEY"]),
    paidAmount: z.number().int().min(0).max(1_000_000),
    paymentRef: z.string().trim().toUpperCase().max(40).optional(),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({ action: z.literal("NO_SHOW") }),
  z.object({ action: z.literal("CANCEL"), note: z.string().trim().max(300).optional() }),
]);

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown, res: Response): z.infer<S> | null {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: firstError(parsed.error) });
    return null;
  }
  return parsed.data;
}

export function adminChargingRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/charging/summary", async (_req, res) => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [stations, todayRows, monthRows] = await Promise.all([
      prisma.chargingStation.count({ where: { active: true } }),
      prisma.chargingBooking.findMany({ where: { startsAt: { gte: today, lt: new Date(today.getTime() + 86_400_000) } }, select: { status: true, paidAmount: true, driverId: true } }),
      prisma.chargingBooking.findMany({ where: { status: "DONE", doneAt: { gte: month } }, select: { paidAmount: true, driverId: true, service: true } }),
    ]);
    const done = todayRows.filter((b) => b.status === "DONE");
    res.json({
      stations,
      today: {
        booked: todayRows.filter((b) => b.status === "BOOKED").length,
        atStation: todayRows.filter((b) => b.status === "CHECKED_IN").length,
        done: done.length,
        collected: done.reduce((s, b) => s + (b.paidAmount ?? 0), 0),
      },
      month: {
        sessions: monthRows.length,
        outside: monthRows.filter((b) => !b.driverId).length,
        swaps: monthRows.filter((b) => b.service === "SWAP").length,
        collected: monthRows.reduce((s, b) => s + (b.paidAmount ?? 0), 0),
      },
    });
  });

  router.get("/charging/stations", async (_req, res) => {
    res.json(await prisma.chargingStation.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }));
  });

  router.post("/charging/stations", async (req, res) => {
    const data = parse(stationInput, req.body, res);
    if (!data) return;
    res.status(201).json(await prisma.chargingStation.create({ data }));
  });

  router.patch("/charging/stations/:id", async (req, res) => {
    const data = parse(patchOf(stationInput), req.body, res);
    if (!data) return;
    const s = await prisma.chargingStation.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!s) {
      res.status(404).json({ error: "Station introuvable" });
      return;
    }
    res.json(s);
  });

  // Réservations d'un jour (aujourd'hui par défaut), d'une station ou de toutes.
  router.get("/charging/bookings", async (req, res) => {
    const now = new Date();
    const day = (typeof req.query.day === "string" && dayStart(req.query.day)) || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const q = typeof req.query.q === "string" ? req.query.q.trim().toUpperCase().slice(0, 30) : "";
    const where: Prisma.ChargingBookingWhereInput = q
      ? { OR: [{ code: { contains: q } }, { plate: { contains: q } }, { phone: { contains: q.replace(/\s/g, "") } }] }
      : {
          startsAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) },
          ...(typeof req.query.stationId === "string" && req.query.stationId ? { stationId: req.query.stationId } : {}),
        };
    res.json(await prisma.chargingBooking.findMany({ where, orderBy: { startsAt: "asc" }, take: 300, include: { station: { select: { id: true, name: true } } } }));
  });

  // Passage sans réservation, noté par l'équipe de la station (la moto est déjà là).
  router.post("/charging/bookings", async (req, res) => {
    const data = parse(walkInInput, req.body, res);
    if (!data) return;
    try {
      res.status(201).json(await book(prisma, { ...data, startsAt: new Date() }, { source: "STATION", handledBy: staffName(res) }));
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res.status(e.status).json({ error: e.message });
    }
  });

  // Arrivée, fin de séance (payée), absent ou annulée. Chaque étape n'est écrite que depuis la précédente.
  router.post("/charging/bookings/:id/action", async (req, res) => {
    const data = parse(actionInput, req.body, res);
    if (!data) return;
    const now = new Date();
    const by = staffName(res);
    const from: Record<string, string[]> = { CHECK_IN: ["BOOKED"], DONE: ["BOOKED", "CHECKED_IN"], NO_SHOW: ["BOOKED"], CANCEL: ["BOOKED", "CHECKED_IN"] };
    const update: Prisma.ChargingBookingUpdateManyMutationInput =
      data.action === "CHECK_IN"
        ? { status: "CHECKED_IN", checkedInAt: now, handledBy: by }
        : data.action === "DONE"
          ? { status: "DONE", doneAt: now, paymentMethod: data.paymentMethod, paidAmount: data.paidAmount, paymentRef: data.paymentRef || null, note: data.note || null, handledBy: by }
          : data.action === "NO_SHOW"
            ? { status: "NO_SHOW", handledBy: by }
            : { status: "CANCELLED", cancelledAt: now, note: data.note || null, handledBy: by };
    const { count } = await prisma.chargingBooking.updateMany({ where: { id: req.params.id, status: { in: from[data.action] } }, data: update });
    if (!count) {
      res.status(409).json({ error: "Cette réservation vient de changer : rechargez la page" });
      return;
    }
    res.json(await prisma.chargingBooking.findUniqueOrThrow({ where: { id: req.params.id }, include: { station: { select: { id: true, name: true } } } }));
  });

  return router;
}
