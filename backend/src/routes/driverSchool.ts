import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "../notify.js";
import { addDays, dayKey, ensureTrips, notifyTripStep, readSchedule } from "../school.js";
import { firstError } from "../util.js";

// Appli conducteur : « Transport scolaire ». Les trajets du jour des abonnements dont il est le conducteur attitré,
// et les étapes : parti, pris en charge, remis (avec le code de remise pour un écolier), ou absent au départ.
// Le conducteur ne voit jamais les codes : il saisit celui que lui donne l'adulte qui reçoit l'enfant.

const passView = {
  select: {
    id: true,
    kind: true,
    riderName: true,
    riderGrade: true,
    schoolName: true,
    schoolAddress: true,
    schoolLatitude: true,
    schoolLongitude: true,
    homeAddress: true,
    homeLatitude: true,
    homeLongitude: true,
    emergencyName: true,
    emergencyPhone: true,
    emergency2Name: true,
    emergency2Phone: true,
    healthNote: true,
    note: true,
    customer: { select: { name: true, phone: true } },
  },
} as const;

const position = { latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() };
const dropInput = z.object({
  code: z.string().trim().max(4).optional(),
  // Personne pour donner le code (école fermée, parent absent mais nounou connue…) : raison, équipe et parent prévenus.
  noCodeReason: z.string().trim().min(5, "Expliquez pourquoi il n'y a pas de code").max(200).optional(),
  ...position,
});
const missedInput = z.object({ note: z.string().trim().min(3, "Dites ce qui s'est passé").max(200) });

export const MAX_CODE_ATTEMPTS = 5;

class TripError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function driverSchoolRoutes(router: Router, prisma: PrismaClient, config: { notifier: Notifier }) {
  const { notifier } = config;

  // Trajet du jour de ce conducteur, encore attitré à l'abonnement.
  async function myTrip(driverId: string, id: string) {
    const trip = await prisma.schoolTrip.findUnique({
      where: { id },
      select: { id: true, date: true, leg: true, status: true, driverId: true, codeAttempts: true, pass: { select: { driverId: true, kind: true, homeCode: true, schoolCode: true } } },
    });
    if (!trip || trip.driverId !== driverId || trip.pass.driverId !== driverId) throw new TripError(404, "Trajet introuvable");
    if (trip.date !== dayKey(new Date())) throw new TripError(409, "Ce trajet n'est pas pour aujourd'hui");
    return trip;
  }

  const fail = (res: import("express").Response, e: unknown) => {
    if (!(e instanceof TripError)) throw e;
    res.status(e.status).json({ error: e.message });
  };

  router.get("/school", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    const today = dayKey(new Date());
    await ensureTrips(prisma, today, { driverId }).catch(() => 0);
    const [trips, passes, tomorrow] = await Promise.all([
      prisma.schoolTrip.findMany({
        where: { driverId, date: today, pass: { driverId } },
        orderBy: { scheduledAt: "asc" },
        select: { id: true, leg: true, scheduledAt: true, status: true, startedAt: true, pickedUpAt: true, droppedAt: true, codeSkipped: true, note: true, pass: passView },
      }),
      prisma.schoolPass.findMany({ where: { driverId, status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { riderName: "asc" }, select: { ...passView.select, status: true, schedule: true, startsOn: true } }),
      prisma.schoolTrip.count({ where: { driverId, date: addDays(today, 1) } }),
    ]);
    res.json({
      today,
      trips,
      passes: passes.map((p) => ({ ...p, schedule: readSchedule(p.schedule) })),
      tomorrowTrips: tomorrow,
    });
  });

  // « Je pars » : le parent est prévenu que le conducteur arrive.
  router.post("/school/trips/:id/start", async (req, res) => {
    try {
      const driverId: string = res.locals.driverId;
      const trip = await myTrip(driverId, String(req.params.id));
      const now = new Date();
      const done = await prisma.schoolTrip.updateMany({ where: { id: trip.id, status: "PLANNED" }, data: { status: "ON_THE_WAY", startedAt: now } });
      if (done.count === 0) throw new TripError(409, "Ce trajet a déjà commencé ou a été annulé");
      await notifyTripStep(prisma, notifier, trip.id, "ON_THE_WAY", now);
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  router.post("/school/trips/:id/pickup", async (req, res) => {
    try {
      const driverId: string = res.locals.driverId;
      const trip = await myTrip(driverId, String(req.params.id));
      const now = new Date();
      const done = await prisma.schoolTrip.updateMany({ where: { id: trip.id, status: { in: ["PLANNED", "ON_THE_WAY"] } }, data: { status: "PICKED_UP", pickedUpAt: now, startedAt: undefined } });
      if (done.count === 0) throw new TripError(409, "Ce trajet n'est plus en attente de prise en charge");
      await prisma.schoolTrip.updateMany({ where: { id: trip.id, startedAt: null }, data: { startedAt: now } });
      await notifyTripStep(prisma, notifier, trip.id, "PICKED_UP", now);
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  // Remise : pour un écolier, le code de l'école (aller) ou de la maison (retour), ou une raison s'il n'y en a pas.
  router.post("/school/trips/:id/drop", async (req, res) => {
    const parsed = dropInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const driverId: string = res.locals.driverId;
      const trip = await myTrip(driverId, String(req.params.id));
      if (trip.status !== "PICKED_UP") throw new TripError(409, "Prenez d'abord l'élève en charge");
      const { code, noCodeReason, latitude, longitude } = parsed.data;
      let skipped = false;
      if (trip.pass.kind === "SCHOOL") {
        const expected = trip.leg === "GO" ? trip.pass.schoolCode : trip.pass.homeCode;
        if (code) {
          // Pas de devinette : 5 codes faux au plus par trajet.
          if (trip.codeAttempts >= MAX_CODE_ATTEMPTS) throw new TripError(429, "Trop de codes faux : appelez Zedeka avant de remettre l'enfant");
          if (!expected || code !== expected) {
            await prisma.schoolTrip.update({ where: { id: trip.id }, data: { codeAttempts: { increment: 1 } } });
            throw new TripError(400, "Code de remise incorrect : redemandez-le à l'adulte qui reçoit l'enfant");
          }
        } else if (noCodeReason) skipped = true;
        else throw new TripError(400, trip.leg === "GO" ? "Demandez le code de remise à l'école" : "Demandez le code de remise à l'adulte qui reçoit l'enfant");
      }
      const now = new Date();
      const done = await prisma.schoolTrip.updateMany({
        where: { id: trip.id, status: "PICKED_UP" },
        data: { status: "DROPPED", droppedAt: now, dropLatitude: latitude ?? null, dropLongitude: longitude ?? null, codeSkipped: skipped, note: skipped ? noCodeReason : undefined },
      });
      if (done.count === 0) throw new TripError(409, "Ce trajet est déjà terminé");
      await notifyTripStep(prisma, notifier, trip.id, skipped ? "NO_CODE" : "DROPPED", now);
      if (skipped) {
        const info = await prisma.schoolTrip.findUnique({ where: { id: trip.id }, select: { pass: { select: { id: true, riderName: true } }, driver: { select: { name: true, phone: true } } } });
        await notifier
          .staff("ORDERS", {
            title: "Transport scolaire : remise sans code",
            body: `${info?.pass.riderName} remis(e) sans code par ${info?.driver?.name} (${info?.driver?.phone}) : ${noCodeReason}`,
            url: `/admin/ecole/${info?.pass.id}`,
            tag: `school-nocode-${trip.id}`,
            alarm: true,
          })
          .catch(() => {});
      }
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  // Personne au départ (enfant absent, école fermée) : le trajet n'est pas fait, le parent est prévenu.
  router.post("/school/trips/:id/missed", async (req, res) => {
    const parsed = missedInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const driverId: string = res.locals.driverId;
      const trip = await myTrip(driverId, String(req.params.id));
      const done = await prisma.schoolTrip.updateMany({ where: { id: trip.id, status: { in: ["PLANNED", "ON_THE_WAY"] } }, data: { status: "MISSED", note: parsed.data.note } });
      if (done.count === 0) throw new TripError(409, "Ce trajet ne peut plus être marqué absent");
      await notifyTripStep(prisma, notifier, trip.id, "MISSED");
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });
}
