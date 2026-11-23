import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "../notify.js";
import { formatFcfa } from "../pricing.js";
import {
  cancelPlannedTrips,
  dayKey,
  driverEligibilityError,
  ensureTrips,
  isDate,
  KIND_LABEL,
  monthKey,
  monthState,
  PASS_KINDS,
  readSchedule,
  scheduleConflicts,
  type PassKind,
} from "../school.js";
import { staffName } from "../team.js";
import { firstError, getSettings } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Admin : transport scolaire (src/school.ts). Demandes à valider, conducteur attitré, paiements mensuels encaissés
// par l'équipe, absences, jours fériés, trajets du jour et vérification des conducteurs pour le transport d'enfants.
// Données des élèves : réservées au directeur et à l'administrateur adjoint (pas de règle pour les autres rôles).

const driverBrief = { select: { id: true, name: true, phone: true, plate: true, zedStatus: true, schoolCleared: true } } as const;
const customerBrief = { select: { id: true, name: true, phone: true } } as const;

const approveInput = z.object({
  driverId: z.string().min(1, "Choisissez le conducteur attitré"),
  monthlyFee: z.number().int().min(0).max(1_000_000).optional(),
  startsOn: z.string().trim().max(10).nullish(),
  force: z.boolean().optional(),
});
const assignInput = z.object({ driverId: z.string().min(1, "Choisissez un conducteur"), force: z.boolean().optional() });
const statusInput = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ENDED", "REJECTED"]), note: z.string().trim().max(300).nullish() });
const editInput = z
  .object({
    monthlyFee: z.number().int().min(0).max(1_000_000),
    startsOn: z.string().trim().max(10).nullable(),
    riderGrade: z.string().trim().max(60).nullable(),
    schoolName: z.string().trim().min(2).max(120),
    schoolAddress: z.string().trim().min(3).max(200),
    homeAddress: z.string().trim().min(3).max(200),
    note: z.string().trim().max(300).nullable(),
  })
  .partial();
const paymentInput = z.object({
  month: z.string().refine((m) => m.length === 7 && isDate(`${m}-01`), "Mois invalide (AAAA-MM)"),
  amount: z.number().int().min(0).max(1_000_000).optional(),
  method: z.enum(["CASH", "BANK", "OTHER"]),
  note: z.string().trim().max(200).nullish(),
});
const holidayInput = z.object({
  date: z.string().refine(isDate, "Date invalide"),
  label: z.string().trim().min(2, "Donnez un nom (ex. Fête de l'indépendance)").max(80),
  kind: z.enum(["ALL", "SCHOOL", "STUDENT"]).default("ALL"),
  until: z.string().refine(isDate, "Date de fin invalide").optional(),
});
const absenceInput = z.object({ date: z.string().refine(isDate, "Date invalide"), leg: z.enum(["BOTH", "GO", "BACK"]).default("BOTH"), reason: z.string().trim().max(200).nullish() });

const fail = (res: import("express").Response, e: unknown) => {
  if (!(e instanceof HttpError)) throw e;
  res.status(e.status).json({ error: e.message });
};

export function adminSchoolRouter(prisma: PrismaClient, config: { notifier: Notifier }) {
  const router = Router();
  const { notifier } = config;

  async function conflictsFor(driverId: string, passId: string, schedule: string) {
    const others = await prisma.schoolPass.findMany({ where: { driverId, status: { in: ["ACTIVE", "PAUSED"] }, id: { not: passId } }, select: { riderName: true, schedule: true } });
    return scheduleConflicts(readSchedule(schedule), others);
  }

  // Vérifie le conducteur et les créneaux : 409 avec la liste des conflits (forcer avec force: true).
  async function checkDriver(driverId: string, pass: { id: string; kind: string; schedule: string }, force?: boolean) {
    const problem = await driverEligibilityError(prisma, driverId, pass.kind as PassKind, pass.id);
    if (problem) throw new HttpError(409, problem);
    const conflicts = await conflictsFor(driverId, pass.id, pass.schedule);
    if (conflicts.length > 0 && !force) throw Object.assign(new HttpError(409, `Créneaux trop proches pour ce conducteur : ${conflicts.join(" ; ")}`), { conflicts });
  }

  router.get("/school/summary", async (_req, res) => {
    const now = new Date();
    const today = dayKey(now);
    await ensureTrips(prisma, today).catch(() => 0);
    const [counts, active, trips, s, collected] = await Promise.all([
      prisma.schoolPass.groupBy({ by: ["status", "kind"], _count: { _all: true } }),
      prisma.schoolPass.findMany({ where: { status: "ACTIVE" }, select: { monthlyFee: true, status: true, driverId: true, payments: { where: { month: monthKey(now) }, select: { month: true, amount: true } } } }),
      prisma.schoolTrip.groupBy({ by: ["status"], where: { date: today }, _count: { _all: true } }),
      getSettings(prisma),
      prisma.schoolPassPayment.aggregate({ _sum: { amount: true }, where: { month: monthKey(now) } }),
    ]);
    const count = (status: string, kind?: string) => counts.filter((c) => c.status === status && (!kind || c.kind === kind)).reduce((n, c) => n + c._count._all, 0);
    const months = active.map((p) => monthState(p, s.schoolGraceDays, now));
    res.json({
      pending: count("PENDING"),
      active: count("ACTIVE"),
      activeSchool: count("ACTIVE", "SCHOOL"),
      activeStudent: count("ACTIVE", "STUDENT"),
      paused: count("PAUSED"),
      withoutDriver: active.filter((p) => !p.driverId).length,
      unpaid: months.filter((m) => !m.paid).length,
      expectedThisMonth: active.reduce((n, p) => n + p.monthlyFee, 0),
      collectedThisMonth: collected._sum.amount ?? 0,
      tripsToday: Object.fromEntries(trips.map((t) => [t.status, t._count._all])),
      fees: { SCHOOL: { round: s.schoolMonthlyFee, oneWay: s.schoolOneWayFee }, STUDENT: { round: s.studentMonthlyFee, oneWay: s.studentOneWayFee } },
      graceDays: s.schoolGraceDays,
      maxPerDriver: s.schoolMaxPerDriver,
    });
  });

  router.get("/school/passes", async (req, res) => {
    const now = new Date();
    const status = z.enum(["PENDING", "ACTIVE", "PAUSED", "ENDED", "REJECTED", "OPEN"]).catch("OPEN").parse(req.query.status);
    const kind = z.enum(PASS_KINDS).optional().catch(undefined).parse(req.query.kind);
    const s = await getSettings(prisma);
    const rows = await prisma.schoolPass.findMany({
      where: { status: status === "OPEN" ? { in: ["ACTIVE", "PAUSED"] } : status, ...(kind ? { kind } : {}) },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        kind: true,
        riderName: true,
        riderGrade: true,
        schoolName: true,
        homeAddress: true,
        status: true,
        monthlyFee: true,
        schedule: true,
        createdAt: true,
        startsOn: true,
        customer: customerBrief,
        driver: driverBrief,
        payments: { select: { month: true, amount: true } },
      },
    });
    res.json(rows.map(({ payments, schedule, ...p }) => ({ ...p, schedule: readSchedule(schedule), month: monthState({ ...p, payments }, s.schoolGraceDays, now) })));
  });

  router.get("/school/passes/:id", async (req, res) => {
    const id = String(req.params.id);
    const today = dayKey(new Date());
    const [pass, s] = await Promise.all([
      prisma.schoolPass.findUnique({
        where: { id },
        include: {
          customer: customerBrief,
          driver: driverBrief,
          payments: { orderBy: { month: "desc" } },
          absences: { orderBy: { date: "desc" }, take: 60 },
          trips: { orderBy: [{ date: "desc" }, { scheduledAt: "desc" }], take: 60, include: { driver: { select: { id: true, name: true } } } },
        },
      }),
      getSettings(prisma),
    ]);
    if (!pass) {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    const conflicts = pass.driverId ? await conflictsFor(pass.driverId, pass.id, pass.schedule) : [];
    res.json({ ...pass, schedule: readSchedule(pass.schedule), month: monthState(pass, s.schoolGraceDays), conflicts, today });
  });

  // Conducteurs pour le transport scolaire : Course Zed actifs, avec la vérification « enfants » et leur charge.
  router.get("/school/drivers", async (_req, res) => {
    const [drivers, loads] = await Promise.all([
      prisma.driver.findMany({
        where: { status: "APPROVED", deletedAt: null, zedStatus: "ACTIVE" },
        orderBy: [{ schoolCleared: "desc" }, { name: "asc" }],
        select: { id: true, name: true, phone: true, plate: true, vehicle: true, active: true, schoolCleared: true, schoolClearedAt: true, schoolClearedBy: true },
      }),
      prisma.schoolPass.groupBy({ by: ["driverId"], where: { status: { in: ["ACTIVE", "PAUSED"] }, driverId: { not: null } }, _count: { _all: true } }),
      getSettings(prisma),
    ]);
    const load = new Map(loads.map((l) => [l.driverId, l._count._all]));
    res.json(drivers.map((d) => ({ ...d, passes: load.get(d.id) ?? 0 })));
  });

  // Vérification pour le transport d'enfants (pièces, casier judiciaire, entretien) : posée ou retirée par l'équipe.
  // Retirée : les abonnements écoliers de ce conducteur perdent leur conducteur (à réattribuer).
  router.post("/school/drivers/:id/clearance", async (req, res) => {
    const parsed = z.object({ cleared: z.boolean() }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const id = String(req.params.id);
    const driver = await prisma.driver.findUnique({ where: { id }, select: { zedStatus: true, deletedAt: true } });
    if (!driver || driver.deletedAt) {
      res.status(404).json({ error: "Conducteur introuvable" });
      return;
    }
    if (parsed.data.cleared && driver.zedStatus !== "ACTIVE") {
      res.status(409).json({ error: "Seuls les conducteurs Course Zed actifs peuvent être vérifiés pour le transport scolaire" });
      return;
    }
    const { cleared } = parsed.data;
    await prisma.driver.update({ where: { id }, data: { schoolCleared: cleared, schoolClearedAt: cleared ? new Date() : null, schoolClearedBy: cleared ? staffName(res) : null } });
    let unassigned = 0;
    if (!cleared) {
      const passes = await prisma.schoolPass.findMany({ where: { driverId: id, kind: "SCHOOL", status: { in: ["ACTIVE", "PAUSED", "PENDING"] } }, select: { id: true } });
      unassigned = passes.length;
      await prisma.schoolPass.updateMany({ where: { id: { in: passes.map((p) => p.id) } }, data: { driverId: null } });
      await prisma.schoolTrip.updateMany({ where: { passId: { in: passes.map((p) => p.id) }, status: "PLANNED" }, data: { driverId: null } });
    }
    res.json({ ok: true, unassigned });
  });

  // Validation d'une demande : conducteur attitré, prix du mois (proposé d'après les réglages), date de début.
  router.post("/school/passes/:id/approve", async (req, res) => {
    const parsed = approveInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const id = String(req.params.id);
      const pass = await prisma.schoolPass.findUnique({ where: { id }, select: { id: true, kind: true, status: true, schedule: true, customerId: true, riderName: true } });
      if (!pass) throw new HttpError(404, "Abonnement introuvable");
      if (pass.status !== "PENDING") throw new HttpError(409, "Cette demande a déjà été traitée");
      const d = parsed.data;
      if (d.startsOn && !isDate(d.startsOn)) throw new HttpError(400, "Date de début invalide");
      await checkDriver(d.driverId, pass, d.force);
      const updated = await prisma.schoolPass.update({
        where: { id },
        data: {
          status: "ACTIVE",
          driverId: d.driverId,
          ...(d.monthlyFee !== undefined ? { monthlyFee: d.monthlyFee } : {}),
          ...(d.startsOn !== undefined ? { startsOn: d.startsOn || null } : {}),
          reviewedAt: new Date(),
          reviewedBy: staffName(res),
          statusNote: null,
        },
        select: { monthlyFee: true, startsOn: true, driver: { select: { name: true } } },
      });
      await notifier
        .push("customer", pass.customerId, {
          title: "Abonnement validé",
          body: `${pass.riderName} : conducteur ${updated.driver?.name ?? ""}, ${formatFcfa(updated.monthlyFee)} par mois, à régler au bureau Zedeka.`,
          url: `/app/ecole/${id}`,
          tag: `school-${id}`,
        })
        .catch(() => {});
      await notifier
        .push("driver", d.driverId, { title: "Nouvel abonnement scolaire", body: `Vous êtes le conducteur attitré de ${pass.riderName}.`, url: "/livreur/ecole", tag: `school-pass-${id}` })
        .catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof HttpError && "conflicts" in e) {
        res.status(409).json({ error: e.message, conflicts: (e as HttpError & { conflicts: string[] }).conflicts });
        return;
      }
      fail(res, e);
    }
  });

  // Changer de conducteur attitré : les trajets pas encore commencés passent au nouveau.
  router.post("/school/passes/:id/assign", async (req, res) => {
    const parsed = assignInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const id = String(req.params.id);
      const pass = await prisma.schoolPass.findUnique({ where: { id }, select: { id: true, kind: true, status: true, schedule: true, customerId: true, riderName: true, driverId: true } });
      if (!pass) throw new HttpError(404, "Abonnement introuvable");
      if (pass.status === "ENDED" || pass.status === "REJECTED") throw new HttpError(409, "Abonnement terminé");
      const { driverId, force } = parsed.data;
      await checkDriver(driverId, pass, force);
      await prisma.schoolPass.update({ where: { id }, data: { driverId } });
      await prisma.schoolTrip.updateMany({ where: { passId: id, status: "PLANNED" }, data: { driverId } });
      const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true, plate: true } });
      if (pass.driverId !== driverId) {
        await notifier
          .push("customer", pass.customerId, {
            title: "Nouveau conducteur attitré",
            body: `${pass.riderName} sera transporté(e) par ${driver?.name}${driver?.plate ? ` (${driver.plate})` : ""}.`,
            url: `/app/ecole/${id}`,
            tag: `school-${id}`,
          })
          .catch(() => {});
        await notifier.push("driver", driverId, { title: "Nouvel abonnement scolaire", body: `Vous êtes le conducteur attitré de ${pass.riderName}.`, url: "/livreur/ecole", tag: `school-pass-${id}` }).catch(() => {});
        if (pass.driverId)
          await notifier.push("driver", pass.driverId, { title: "Abonnement scolaire retiré", body: `${pass.riderName} est confié(e) à un autre conducteur.`, url: "/livreur/ecole", tag: `school-pass-${id}` }).catch(() => {});
      }
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof HttpError && "conflicts" in e) {
        res.status(409).json({ error: e.message, conflicts: (e as HttpError & { conflicts: string[] }).conflicts });
        return;
      }
      fail(res, e);
    }
  });

  // Pause (vacances, impayé), reprise, fin ou refus. Les trajets pas commencés à partir d'aujourd'hui sont annulés.
  router.post("/school/passes/:id/status", async (req, res) => {
    const parsed = statusInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const id = String(req.params.id);
      const pass = await prisma.schoolPass.findUnique({ where: { id }, select: { status: true, customerId: true, riderName: true, driverId: true } });
      if (!pass) throw new HttpError(404, "Abonnement introuvable");
      const { status, note } = parsed.data;
      if (status === "REJECTED" && pass.status !== "PENDING") throw new HttpError(409, "Seule une demande se refuse ; terminez l'abonnement");
      if (status === "ACTIVE" && pass.status !== "PAUSED") throw new HttpError(409, "Seul un abonnement en pause reprend ; validez une demande avec un conducteur");
      if (status === "PAUSED" && pass.status !== "ACTIVE") throw new HttpError(409, "Seul un abonnement en cours se met en pause");
      if (pass.status === "ENDED" || pass.status === "REJECTED") throw new HttpError(409, "Abonnement déjà terminé");
      await prisma.schoolPass.update({
        where: { id },
        data: { status, statusNote: note || null, ...(status === "ENDED" || status === "REJECTED" ? { endedAt: new Date() } : {}), reviewedBy: staffName(res), reviewedAt: new Date() },
      });
      if (status !== "ACTIVE") await prisma.schoolTrip.updateMany({ where: { passId: id, status: "PLANNED", date: { gte: dayKey(new Date()) } }, data: { status: "CANCELLED", note: note || "Abonnement arrêté" } });
      const titles = { ACTIVE: "Abonnement repris", PAUSED: "Abonnement en pause", ENDED: "Abonnement terminé", REJECTED: "Demande refusée" } as const;
      await notifier
        .push("customer", pass.customerId, { title: titles[status], body: `${pass.riderName}${note ? ` : ${note}` : ""}`, url: `/app/ecole/${id}`, tag: `school-${id}` })
        .catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  router.patch("/school/passes/:id", async (req, res) => {
    const parsed = editInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    if (parsed.data.startsOn && !isDate(parsed.data.startsOn)) {
      res.status(400).json({ error: "Date de début invalide" });
      return;
    }
    const id = String(req.params.id);
    const done = await prisma.schoolPass.updateMany({ where: { id }, data: parsed.data });
    if (done.count === 0) {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    res.json({ ok: true });
  });

  // Mois encaissé (espèces au bureau, virement…). Montant par défaut : le prix du mois de l'abonnement.
  router.post("/school/passes/:id/payments", async (req, res) => {
    const parsed = paymentInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const id = String(req.params.id);
    const pass = await prisma.schoolPass.findUnique({ where: { id }, select: { monthlyFee: true, customerId: true, riderName: true, status: true } });
    if (!pass) {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    const { month, amount, method, note } = parsed.data;
    const exists = await prisma.schoolPassPayment.findUnique({ where: { passId_month: { passId: id, month } } });
    if (exists) {
      res.status(409).json({ error: "Ce mois est déjà enregistré comme payé" });
      return;
    }
    const payment = await prisma.schoolPassPayment.create({ data: { passId: id, month, amount: amount ?? pass.monthlyFee, method, note: note || null, recordedBy: staffName(res) } });
    // Mois payé : les trajets d'aujourd'hui reprennent s'ils étaient arrêtés faute de paiement.
    if (month === monthKey(new Date())) await ensureTrips(prisma, dayKey(new Date()), { passId: id }).catch(() => 0);
    const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
    await notifier
      .push("customer", pass.customerId, { title: "Paiement reçu", body: `${pass.riderName} : ${label} payé (${formatFcfa(payment.amount)}). Merci !`, url: `/app/ecole/${id}`, tag: `school-pay-${id}` })
      .catch(() => {});
    res.status(201).json(payment);
  });

  // Correction d'une saisie.
  router.delete("/school/payments/:id", async (req, res) => {
    const done = await prisma.schoolPassPayment.deleteMany({ where: { id: String(req.params.id) } });
    if (done.count === 0) {
      res.status(404).json({ error: "Paiement introuvable" });
      return;
    }
    res.json({ ok: true });
  });

  // Absence saisie par l'équipe (parent qui appelle).
  router.post("/school/passes/:id/absences", async (req, res) => {
    const parsed = absenceInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const id = String(req.params.id);
    const pass = await prisma.schoolPass.findUnique({ where: { id }, select: { id: true } });
    if (!pass) {
      res.status(404).json({ error: "Abonnement introuvable" });
      return;
    }
    const { date, leg, reason } = parsed.data;
    await prisma.schoolAbsence.upsert({
      where: { passId_date_leg: { passId: id, date, leg } },
      update: { reason: reason || null },
      create: { passId: id, date, leg, reason: reason || null, createdBy: staffName(res) ?? "équipe" },
    });
    await cancelPlannedTrips(prisma, { passId: id, date, legs: leg === "BOTH" ? ["GO", "BACK"] : [leg] }, "Absence signalée");
    res.status(201).json({ ok: true });
  });

  router.delete("/school/absences/:id", async (req, res) => {
    const done = await prisma.schoolAbsence.deleteMany({ where: { id: String(req.params.id) } });
    if (done.count === 0) {
      res.status(404).json({ error: "Absence introuvable" });
      return;
    }
    res.json({ ok: true });
  });

  // Jours fériés et vacances : pas de trajets ces jours-là.
  router.get("/school/holidays", async (_req, res) => {
    res.json(await prisma.schoolHoliday.findMany({ where: { date: { gte: dayKey(new Date(Date.now() - 31 * 86_400_000)) } }, orderBy: { date: "asc" }, take: 400 }));
  });

  // Un jour, ou une période (vacances) jusqu'à « until » compris, au plus 120 jours.
  router.post("/school/holidays", async (req, res) => {
    const parsed = holidayInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const { date, label, kind, until } = parsed.data;
    const end = until ?? date;
    if (end < date) {
      res.status(400).json({ error: "La date de fin doit suivre la date de début" });
      return;
    }
    const days: string[] = [];
    for (let d = new Date(`${date}T00:00:00Z`); dayKey(d) <= end; d = new Date(d.getTime() + 86_400_000)) days.push(dayKey(d));
    if (days.length > 120) {
      res.status(400).json({ error: "Au plus 120 jours d'un coup" });
      return;
    }
    for (const day of days) {
      await prisma.schoolHoliday.upsert({ where: { date_kind: { date: day, kind } }, update: { label }, create: { date: day, label, kind, createdBy: staffName(res) } });
      await cancelPlannedTrips(prisma, { date: day, kind }, label);
    }
    res.status(201).json({ ok: true, days: days.length });
  });

  router.delete("/school/holidays/:id", async (req, res) => {
    const done = await prisma.schoolHoliday.deleteMany({ where: { id: String(req.params.id) } });
    if (done.count === 0) {
      res.status(404).json({ error: "Jour introuvable" });
      return;
    }
    res.json({ ok: true });
  });

  // Tableau des trajets d'un jour (aujourd'hui par défaut).
  router.get("/school/trips", async (req, res) => {
    const date = typeof req.query.date === "string" && isDate(req.query.date) ? req.query.date : dayKey(new Date());
    if (date === dayKey(new Date())) await ensureTrips(prisma, date).catch(() => 0);
    res.json(
      await prisma.schoolTrip.findMany({
        where: { date },
        orderBy: { scheduledAt: "asc" },
        include: {
          pass: { select: { id: true, kind: true, riderName: true, schoolName: true, homeAddress: true, customer: customerBrief } },
          driver: { select: { id: true, name: true, phone: true } },
        },
      }),
    );
  });

  return router;
}

export const schoolKindLabel = (kind: string) => KIND_LABEL[kind as PassKind] ?? kind;
