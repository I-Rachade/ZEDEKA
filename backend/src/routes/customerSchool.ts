import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { normalizePhone } from "../customer.js";
import type { Notifier } from "../notify.js";
import {
  addDays,
  cancelPlannedTrips,
  dayKey,
  ensureTrips,
  isDate,
  KIND_LABEL,
  LIVE_POSITION_MS,
  MAX_PASSES_PER_CUSTOMER,
  monthlyFeeFor,
  monthState,
  newCode,
  parseSchedule,
  PASS_KINDS,
  readSchedule,
  type PassKind,
} from "../school.js";
import { firstError, getSettings } from "../util.js";

// Appli client : abonnements de transport scolaire du parent (écoliers) ou de l'étudiant lui-même. Le client ne voit
// que ses abonnements ; du conducteur attitré, il voit le nom, la plaque, le téléphone et, pendant un trajet, la position.

const phone = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numéro togolais invalide (8 chiffres)" });
    return z.NEVER;
  }
  return p;
});
const optionalPhone = z.union([z.literal("").transform(() => null), z.null(), phone]).optional();
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max);
const lat = z.number().min(-90).max(90).nullish();
const lng = z.number().min(-180).max(180).nullish();

const createInput = z.object({
  kind: z.enum(PASS_KINDS, { error: "Choisissez écolier ou étudiant" }),
  riderName: text(2, 80, "Indiquez le nom de l'élève"),
  riderGrade: z.string().trim().max(60).nullish(),
  schoolName: text(2, 120, "Indiquez l'école ou l'université"),
  schoolAddress: text(3, 200, "Indiquez l'adresse de l'école"),
  schoolLatitude: lat,
  schoolLongitude: lng,
  homeAddress: text(3, 200, "Indiquez l'adresse de la maison"),
  homeLatitude: lat,
  homeLongitude: lng,
  schedule: z.unknown(),
  emergencyName: text(2, 80, "Indiquez un contact d'urgence"),
  emergencyPhone: phone,
  emergency2Name: z.string().trim().max(80).nullish(),
  emergency2Phone: optionalPhone,
  healthNote: z.string().trim().max(300).nullish(),
  note: z.string().trim().max(300).nullish(),
  startsOn: z.string().trim().max(10).nullish(),
});

const editInput = z
  .object({
    emergencyName: text(2, 80, "Indiquez un contact d'urgence"),
    emergencyPhone: phone,
    emergency2Name: z.string().trim().max(80).nullable(),
    emergency2Phone: optionalPhone,
    healthNote: z.string().trim().max(300).nullable(),
    note: z.string().trim().max(300).nullable(),
  })
  .partial();

const absenceInput = z.object({
  date: z.string().refine(isDate, "Date invalide"),
  leg: z.enum(["BOTH", "GO", "BACK"]).default("BOTH"),
  reason: z.string().trim().max(200).nullish(),
});

const driverView = { select: { id: true, name: true, phone: true, plate: true, vehicle: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true } } as const;
const tripView = { select: { id: true, date: true, leg: true, scheduledAt: true, status: true, startedAt: true, pickedUpAt: true, droppedAt: true, codeSkipped: true, note: true } } as const;

export function customerSchoolRoutes(router: Router, prisma: PrismaClient, notifier: Notifier) {
  async function ownPass(customerId: string, id: string) {
    return prisma.schoolPass.findFirst({ where: { id, customerId }, select: { id: true, kind: true, status: true, riderName: true, driverId: true } });
  }

  // Liste des abonnements et tarifs indicatifs (réglages) pour le formulaire.
  router.get("/school", async (_req, res) => {
    const customerId: string = res.locals.customerId;
    const [passes, s] = await Promise.all([
      prisma.schoolPass.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          riderName: true,
          schoolName: true,
          status: true,
          monthlyFee: true,
          schedule: true,
          driver: { select: { name: true, plate: true } },
          payments: { select: { month: true, amount: true } },
        },
      }),
      getSettings(prisma),
    ]);
    res.json({
      passes: passes.map(({ payments, schedule, ...p }) => ({ ...p, schedule: readSchedule(schedule), month: monthState({ ...p, payments }, s.schoolGraceDays) })),
      fees: { SCHOOL: { round: s.schoolMonthlyFee, oneWay: s.schoolOneWayFee }, STUDENT: { round: s.studentMonthlyFee, oneWay: s.studentOneWayFee } },
      graceDays: s.schoolGraceDays,
    });
  });

  router.post("/school/passes", async (req, res) => {
    const parsed = createInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const d = parsed.data;
    const schedule = parseSchedule(d.schedule);
    if (typeof schedule === "string") {
      res.status(400).json({ error: schedule });
      return;
    }
    const today = dayKey(new Date());
    if (d.startsOn && (!isDate(d.startsOn) || d.startsOn < today || d.startsOn > addDays(today, 120))) {
      res.status(400).json({ error: "Date de début invalide (dans les 4 prochains mois)" });
      return;
    }
    const customerId: string = res.locals.customerId;
    const open = await prisma.schoolPass.count({ where: { customerId, status: { in: ["PENDING", "ACTIVE", "PAUSED"] } } });
    if (open >= MAX_PASSES_PER_CUSTOMER) {
      res.status(409).json({ error: `Au plus ${MAX_PASSES_PER_CUSTOMER} abonnements en cours par compte` });
      return;
    }
    const s = await getSettings(prisma);
    const kind = d.kind as PassKind;
    const pass = await prisma.schoolPass.create({
      data: {
        customerId,
        kind,
        riderName: d.riderName,
        riderGrade: d.riderGrade || null,
        schoolName: d.schoolName,
        schoolAddress: d.schoolAddress,
        schoolLatitude: d.schoolLatitude ?? null,
        schoolLongitude: d.schoolLongitude ?? null,
        homeAddress: d.homeAddress,
        homeLatitude: d.homeLatitude ?? null,
        homeLongitude: d.homeLongitude ?? null,
        schedule: JSON.stringify(schedule),
        emergencyName: d.emergencyName,
        emergencyPhone: d.emergencyPhone,
        emergency2Name: d.emergency2Name || null,
        emergency2Phone: d.emergency2Phone ?? null,
        healthNote: d.healthNote || null,
        note: d.note || null,
        startsOn: d.startsOn || null,
        monthlyFee: monthlyFeeFor(kind, schedule, s),
        // Écolier : codes de remise à la maison et à l'école. Étudiant : pas de code.
        homeCode: kind === "SCHOOL" ? newCode() : null,
        schoolCode: kind === "SCHOOL" ? newCode() : null,
      },
      select: { id: true },
    });
    await notifier
      .staff("ORDERS", {
        title: `Nouvelle demande : ${KIND_LABEL[kind].toLowerCase()}`,
        body: `${d.riderName}, ${d.schoolName}. Choisissez un conducteur et validez.`,
        url: `/admin/ecole/${pass.id}`,
        tag: `school-new-${pass.id}`,
      })
      .catch(() => {});
    res.status(201).json(pass);
  });

  // Fiche : codes, conducteur, trajets d'aujourd'hui et des prochains jours, position en direct, absences, paiements.
  router.get("/school/passes/:id", async (req, res) => {
    const customerId: string = res.locals.customerId;
    const id = String(req.params.id);
    const now = new Date();
    const today = dayKey(now);
    if (!(await ownPass(customerId, id))) {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    await ensureTrips(prisma, today, { passId: id }).catch(() => 0);
    const [pass, s] = await Promise.all([
      prisma.schoolPass.findUniqueOrThrow({
        where: { id },
        include: {
          driver: driverView,
          payments: { orderBy: { month: "desc" }, select: { id: true, month: true, amount: true, method: true, createdAt: true } },
          absences: { where: { date: { gte: today } }, orderBy: { date: "asc" }, select: { id: true, date: true, leg: true, reason: true } },
          trips: { where: { date: { gte: addDays(today, -14) } }, orderBy: [{ date: "desc" }, { scheduledAt: "desc" }], take: 30, ...tripView },
        },
      }),
      getSettings(prisma),
    ]);
    const { driver, payments, customerId: _c, reviewedBy: _r, ...rest } = pass;
    const moving = pass.trips.some((t) => t.date === today && (t.status === "ON_THE_WAY" || t.status === "PICKED_UP"));
    const fresh = driver?.lastLocationAt && now.getTime() - driver.lastLocationAt.getTime() < LIVE_POSITION_MS;
    res.json({
      ...rest,
      schedule: readSchedule(pass.schedule),
      driver: driver
        ? {
            id: driver.id,
            name: driver.name,
            phone: driver.phone,
            plate: driver.plate,
            vehicle: driver.vehicle,
            // Position seulement pendant un trajet en cours.
            position: moving && fresh ? { latitude: driver.lastLatitude, longitude: driver.lastLongitude, at: driver.lastLocationAt } : null,
          }
        : null,
      payments,
      month: monthState({ ...pass, payments }, s.schoolGraceDays, now),
      today,
    });
  });

  router.patch("/school/passes/:id", async (req, res) => {
    const parsed = editInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const customerId: string = res.locals.customerId;
    const id = String(req.params.id);
    if (!(await ownPass(customerId, id))) {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    const d = parsed.data;
    await prisma.schoolPass.update({
      where: { id },
      data: { ...d, emergency2Name: d.emergency2Name === undefined ? undefined : d.emergency2Name || null, healthNote: d.healthNote === undefined ? undefined : d.healthNote || null, note: d.note === undefined ? undefined : d.note || null },
    });
    res.json({ ok: true });
  });

  // Nouveaux codes de remise (code partagé par erreur, changement de nounou…).
  router.post("/school/passes/:id/codes", async (req, res) => {
    const customerId: string = res.locals.customerId;
    const id = String(req.params.id);
    const pass = await ownPass(customerId, id);
    if (!pass || pass.kind !== "SCHOOL") {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    const updated = await prisma.schoolPass.update({ where: { id }, data: { homeCode: newCode(), schoolCode: newCode() }, select: { homeCode: true, schoolCode: true } });
    res.json(updated);
  });

  // Absence (malade, sortie, pas d'école) : pas de trajet ce jour-là, le conducteur ne se déplace pas.
  router.post("/school/passes/:id/absences", async (req, res) => {
    const parsed = absenceInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const customerId: string = res.locals.customerId;
    const id = String(req.params.id);
    const pass = await ownPass(customerId, id);
    if (!pass) {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    const { date, leg, reason } = parsed.data;
    const today = dayKey(new Date());
    if (date < today || date > addDays(today, 90)) {
      res.status(400).json({ error: "Choisissez un jour entre aujourd'hui et les 3 prochains mois" });
      return;
    }
    await prisma.schoolAbsence.upsert({
      where: { passId_date_leg: { passId: id, date, leg } },
      update: { reason: reason || null },
      create: { passId: id, date, leg, reason: reason || null, createdBy: "parent" },
    });
    const legs = leg === "BOTH" ? (["GO", "BACK"] as const) : ([leg] as const);
    const cancelled = await cancelPlannedTrips(prisma, { passId: id, date, legs: [...legs] }, "Absence signalée");
    if (cancelled.count > 0 && date === today && pass.driverId)
      await notifier
        .push("driver", pass.driverId, {
          title: "Trajet scolaire annulé",
          body: `${pass.riderName} est absent(e) aujourd'hui (${leg === "BOTH" ? "aller et retour" : leg === "GO" ? "aller" : "retour"}).`,
          url: "/livreur/ecole",
          tag: `school-absence-${id}`,
        })
        .catch(() => {});
    res.status(201).json({ ok: true });
  });

  router.delete("/school/passes/:id/absences/:absenceId", async (req, res) => {
    const customerId: string = res.locals.customerId;
    const id = String(req.params.id);
    if (!(await ownPass(customerId, id))) {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    // Seulement une absence à venir : le trajet d'aujourd'hui est déjà annulé et le conducteur prévenu.
    const removed = await prisma.schoolAbsence.deleteMany({ where: { id: String(req.params.absenceId), passId: id, date: { gt: dayKey(new Date()) } } });
    if (removed.count === 0) {
      res.status(404).json({ error: "Absence introuvable ou déjà passée" });
      return;
    }
    res.json({ ok: true });
  });

  // Demande retirée avant validation.
  router.post("/school/passes/:id/cancel", async (req, res) => {
    const customerId: string = res.locals.customerId;
    const id = String(req.params.id);
    const done = await prisma.schoolPass.updateMany({ where: { id, customerId, status: "PENDING" }, data: { status: "ENDED", endedAt: new Date(), statusNote: "Demande retirée par le client" } });
    if (done.count === 0) {
      res.status(409).json({ error: "Seule une demande pas encore validée se retire ici. Pour arrêter un abonnement, appelez Zedeka." });
      return;
    }
    res.json({ ok: true });
  });
}
