import { Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  CONTRACT_TYPES,
  DOCUMENT_KINDS,
  EMPLOYEE_STATUSES,
  LEAVE_KINDS,
  LEAVE_STATUSES,
  MAX_DOCUMENT_BYTES,
  PAYMENT_METHODS,
  absenceDeduction,
  csvFile,
  dayField,
  decodeDocument,
  leaveBalance,
  monthOf,
  onPayroll,
  parseMonth,
  payslipNet,
  requiredDay,
  unpaidDaysInMonth,
  upcomingDeadlines,
  workingDays,
} from "../hr.js";
import type { FileStore } from "../storage.js";
import { staffName } from "../team.js";
import { firstError, sendPrismaError } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Admin : ressources humaines (src/hr.ts). Fiches des employés (contrat, poste, salaire, coordonnées), congés et
// absences, documents, et la paie du mois jusqu'à sa validation. Ouvert au rôle HR, au directeur, et en lecture à
// l'administrateur adjoint (voir team.ts). Le paiement des bulletins validés est fait par le comptable.

const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const money = z.number().int().min(0).max(100_000_000);

const employeeInput = z.object({
  name: z.string().trim().min(2, "Nom : 2 caractères minimum").max(80),
  phone: text(30),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(120)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Adresse e-mail invalide"),
  position: z.string().trim().min(2, "Indiquez le poste").max(80),
  department: text(80),
  contractType: z.enum(CONTRACT_TYPES).default("CDI"),
  startDate: requiredDay,
  endDate: dayField.optional(),
  trialEndDate: dayField.optional(),
  monthlySalary: money.default(0),
  paymentMethod: z.enum(PAYMENT_METHODS).default("MOBILE_MONEY"),
  paymentAccount: text(80),
  birthDate: dayField.optional(),
  address: text(200),
  idNumber: text(60),
  cnssNumber: text(60),
  emergencyContact: text(160),
  leaveDaysPerYear: z.number().int().min(0).max(60).default(30),
  status: z.enum(EMPLOYEE_STATUSES).default("ACTIVE"),
  leftAt: dayField.optional(),
  leftReason: text(300),
  notes: text(2000),
  driverId: z.string().trim().max(60).nullish().transform((v) => v || null),
});

const leaveInput = z.object({
  kind: z.enum(LEAVE_KINDS, { errorMap: () => ({ message: "Choisissez le type de congé ou d'absence" }) }),
  startDate: requiredDay,
  endDate: requiredDay,
  reason: text(300),
  status: z.enum(["REQUESTED", "APPROVED"]).default("APPROVED"),
});

const documentInput = z.object({
  kind: z.enum(DOCUMENT_KINDS).default("OTHER"),
  title: z.string().trim().min(2, "Donnez un titre au document").max(120),
  file: z.string().max(4_200_000, "Fichier trop lourd (3 Mo au plus)"),
});

const payslipInput = z.object({
  baseSalary: money.optional(),
  bonus: money.optional(),
  deductions: money.optional(),
  note: text(300),
});

const listQuery = z.object({ status: z.enum([...EMPLOYEE_STATUSES, "ALL"]).catch("ACTIVE"), q: z.string().trim().max(80).catch("") });

const fail = (res: Response, e: unknown) => {
  if (e instanceof HttpError) return void res.status(e.status).json({ error: e.message });
  if (!sendPrismaError(e, res)) throw e;
};

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, firstError(parsed.error));
  return parsed.data;
}

const employeeBrief = { select: { id: true, name: true, position: true, department: true, status: true } } as const;
const documentSelect = { id: true, kind: true, title: true, contentType: true, size: true, uploadedBy: true, createdAt: true } as const;

export function adminHrRouter(prisma: PrismaClient, config: { files?: FileStore }) {
  const router = Router();
  const who = (res: Response) => staffName(res) ?? "Direction";

  // Un livreur ne peut être lié qu'à une seule fiche, et doit exister.
  async function checkDriver(driverId: string | null | undefined, employeeId?: string) {
    if (!driverId) return;
    const [driver, taken] = await Promise.all([
      prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } }),
      prisma.employee.findFirst({ where: { driverId, ...(employeeId ? { id: { not: employeeId } } : {}) }, select: { name: true } }),
    ]);
    if (!driver) throw new HttpError(404, "Livreur introuvable");
    if (taken) throw new HttpError(409, `Ce livreur est déjà lié à la fiche de ${taken.name}`);
  }

  // ---------------------------------------------------------------- Vue d'ensemble

  router.get("/hr/summary", async (_req, res) => {
    const now = new Date();
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const month = parseMonth(monthOf(now))!;
    const [employees, onLeave, pending, slips] = await Promise.all([
      prisma.employee.findMany({
        where: { status: { not: "LEFT" } },
        select: { id: true, name: true, status: true, endDate: true, trialEndDate: true, contractType: true, monthlySalary: true, department: true },
      }),
      prisma.employeeLeave.findMany({ where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } }, include: { employee: employeeBrief } }),
      prisma.employeeLeave.count({ where: { status: "REQUESTED" } }),
      prisma.payslip.groupBy({ by: ["status"], where: { month: month.month }, _count: { _all: true }, _sum: { net: true } }),
    ]);
    const active = employees.filter((e) => e.status === "ACTIVE");
    const departments = new Map<string, number>();
    for (const e of active) departments.set(e.department || "Sans service", (departments.get(e.department || "Sans service") ?? 0) + 1);
    res.json({
      active: active.length,
      suspended: employees.filter((e) => e.status === "SUSPENDED").length,
      monthlyPayroll: active.reduce((s, e) => s + e.monthlySalary, 0),
      onLeaveToday: onLeave.map((l) => ({ id: l.id, kind: l.kind, endDate: l.endDate, employee: l.employee })),
      pendingLeaves: pending,
      deadlines: upcomingDeadlines(employees, now),
      departments: [...departments].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      payroll: {
        month: month.month,
        ...Object.fromEntries(["DRAFT", "VALIDATED", "PAID"].map((s) => [s, slips.find((g) => g.status === s)?._count._all ?? 0])),
        total: slips.reduce((sum, g) => sum + (g._sum.net ?? 0), 0),
      },
    });
  });

  // ---------------------------------------------------------------- Employés

  router.get("/hr/employees", async (req, res) => {
    const { status, q } = listQuery.parse(req.query);
    const rows = await prisma.employee.findMany({
      where: {
        ...(status === "ALL" ? {} : { status }),
        ...(q ? { OR: [{ name: { contains: q } }, { position: { contains: q } }, { phone: { contains: q } }, { department: { contains: q } }] } : {}),
      },
      orderBy: { name: "asc" },
      take: 500,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        position: true,
        department: true,
        contractType: true,
        startDate: true,
        endDate: true,
        monthlySalary: true,
        status: true,
        driverId: true,
      },
    });
    res.json(rows);
  });

  router.post("/hr/employees", async (req, res) => {
    try {
      const data = parse(employeeInput, req.body);
      await checkDriver(data.driverId);
      res.status(201).json(await prisma.employee.create({ data: { ...data, createdBy: who(res) } }));
    } catch (e) {
      fail(res, e);
    }
  });

  router.get("/hr/employees/:id", async (req, res) => {
    const employee = await prisma.employee.findUnique({
      where: { id: String(req.params.id) },
      include: {
        leaves: { orderBy: { startDate: "desc" }, take: 200 },
        documents: { orderBy: { createdAt: "desc" }, select: documentSelect },
        payslips: { orderBy: { month: "desc" }, take: 24 },
      },
    });
    if (!employee) {
      res.status(404).json({ error: "Employé introuvable" });
      return;
    }
    const driver = employee.driverId
      ? await prisma.driver.findUnique({ where: { id: employee.driverId }, select: { id: true, name: true, phone: true, employment: true, status: true } })
      : null;
    res.json({ ...employee, driver, balance: leaveBalance(employee, employee.leaves) });
  });

  router.patch("/hr/employees/:id", async (req, res) => {
    try {
      const id = String(req.params.id);
      const data = parse(employeeInput.partial(), req.body);
      if (data.driverId !== undefined) await checkDriver(data.driverId, id);
      // Départ : la date de sortie par défaut est aujourd'hui ; un retour efface la sortie.
      if (data.status === "LEFT" && data.leftAt === undefined) {
        const current = await prisma.employee.findUnique({ where: { id }, select: { leftAt: true } });
        if (!current?.leftAt) data.leftAt = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      }
      if (data.status === "ACTIVE") Object.assign(data, { leftAt: null, leftReason: null });
      res.json(await prisma.employee.update({ where: { id }, data }));
    } catch (e) {
      fail(res, e);
    }
  });

  // Fiche créée par erreur : supprimée avec ses congés et documents, sauf si un salaire a déjà été payé
  // (la fiche reste alors pour la comptabilité : passer l'employé en « Parti »).
  router.delete("/hr/employees/:id", async (req, res) => {
    const id = String(req.params.id);
    const [paid, docs] = await Promise.all([
      prisma.payslip.count({ where: { employeeId: id, status: "PAID" } }),
      prisma.employeeDocument.findMany({ where: { employeeId: id }, select: { fileKey: true } }),
    ]);
    if (paid > 0) {
      res.status(409).json({ error: "Des salaires ont déjà été payés à cet employé : indiquez plutôt son départ" });
      return;
    }
    try {
      await prisma.employee.delete({ where: { id } });
    } catch (e) {
      return fail(res, e);
    }
    for (const d of docs) await config.files?.delete(d.fileKey).catch(() => {});
    res.status(204).end();
  });

  // Livreurs salariés de Zedeka (statut et salaire réglés par le directeur dans Livreurs) : à lier aux fiches.
  router.get("/hr/drivers", async (_req, res) => {
    const [drivers, linked] = await Promise.all([
      prisma.driver.findMany({
        where: { deletedAt: null, status: "APPROVED", employment: "STAFF" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, phone: true, email: true, monthlySalary: true, active: true, createdAt: true },
      }),
      prisma.employee.findMany({ where: { driverId: { not: null } }, select: { id: true, driverId: true } }),
    ]);
    const byDriver = new Map(linked.map((e) => [e.driverId, e.id]));
    res.json(drivers.map((d) => ({ ...d, employeeId: byDriver.get(d.id) ?? null })));
  });

  // Crée une fiche pour chaque livreur salarié qui n'en a pas encore (poste « Livreur salarié », son salaire).
  router.post("/hr/import-drivers", async (_req, res) => {
    const [drivers, linked] = await Promise.all([
      prisma.driver.findMany({
        where: { deletedAt: null, status: "APPROVED", employment: "STAFF" },
        select: { id: true, name: true, phone: true, email: true, monthlySalary: true, createdAt: true },
      }),
      prisma.employee.findMany({ where: { driverId: { not: null } }, select: { driverId: true } }),
    ]);
    const done = new Set(linked.map((e) => e.driverId));
    let created = 0;
    for (const d of drivers) {
      if (done.has(d.id)) continue;
      try {
        await prisma.employee.create({
          data: {
            name: d.name,
            phone: d.phone,
            email: d.email,
            position: "Livreur salarié",
            department: "Livraison",
            contractType: "CDI",
            startDate: new Date(`${d.createdAt.toISOString().slice(0, 10)}T00:00:00Z`),
            monthlySalary: d.monthlySalary ?? 0,
            driverId: d.id,
            createdBy: who(res),
          },
        });
        created++;
      } catch (e) {
        // Fiche créée entre-temps (deux clics) : ignorée.
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
    }
    res.json({ created });
  });

  // ---------------------------------------------------------------- Congés et absences

  router.get("/hr/leaves", async (req, res) => {
    const status = z.enum([...LEAVE_STATUSES, "ALL"]).catch("ALL").parse(req.query.status);
    const month = parseMonth(req.query.month);
    res.json(
      await prisma.employeeLeave.findMany({
        where: {
          ...(status === "ALL" ? {} : { status }),
          // Congés qui touchent le mois choisi.
          ...(month ? { startDate: { lt: month.end }, endDate: { gte: month.start } } : {}),
        },
        orderBy: { startDate: "desc" },
        take: 300,
        include: { employee: employeeBrief },
      }),
    );
  });

  router.post("/hr/employees/:id/leaves", async (req, res) => {
    try {
      const data = parse(leaveInput, req.body);
      if (data.endDate.getTime() < data.startDate.getTime()) throw new HttpError(400, "La date de fin est avant la date de début");
      const days = workingDays(data.startDate, data.endDate);
      if (days === 0) throw new HttpError(400, "Aucun jour ouvrable sur cette période (dimanches exclus)");
      if (days > 366) throw new HttpError(400, "Période trop longue");
      const employeeId = String(req.params.id);
      const exists = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
      if (!exists) throw new HttpError(404, "Employé introuvable");
      const approved = data.status === "APPROVED";
      res.status(201).json(
        await prisma.employeeLeave.create({
          data: { ...data, employeeId, days, createdBy: who(res), ...(approved ? { decidedBy: who(res), decidedAt: new Date() } : {}) },
        }),
      );
    } catch (e) {
      fail(res, e);
    }
  });

  router.post("/hr/leaves/:id/decide", async (req, res) => {
    try {
      const { decision } = parse(z.object({ decision: z.enum(["APPROVE", "REJECT"]) }), req.body);
      const { count } = await prisma.employeeLeave.updateMany({
        where: { id: String(req.params.id), status: "REQUESTED" },
        data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedBy: who(res), decidedAt: new Date() },
      });
      if (count === 0) throw new HttpError(409, "Cette demande a déjà été traitée");
      res.json(await prisma.employeeLeave.findUnique({ where: { id: String(req.params.id) } }));
    } catch (e) {
      fail(res, e);
    }
  });

  router.delete("/hr/leaves/:id", async (req, res) => {
    try {
      await prisma.employeeLeave.delete({ where: { id: String(req.params.id) } });
      res.status(204).end();
    } catch (e) {
      fail(res, e);
    }
  });

  // ---------------------------------------------------------------- Documents

  router.post("/hr/employees/:id/documents", async (req, res) => {
    try {
      if (!config.files) throw new HttpError(503, "L'envoi des documents n'est pas disponible pour le moment");
      const data = parse(documentInput, req.body);
      const file = decodeDocument(data.file);
      if (!file) throw new HttpError(400, "Envoyez un PDF ou une photo (JPEG, PNG, WebP)");
      if (file.bytes.length > MAX_DOCUMENT_BYTES) throw new HttpError(413, "Fichier trop lourd (3 Mo au plus)");
      const employeeId = String(req.params.id);
      const exists = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
      if (!exists) throw new HttpError(404, "Employé introuvable");
      const fileKey = `rh/${employeeId}/${Date.now()}-${crypto.randomUUID()}`;
      await config.files.put(fileKey, file.bytes, file.contentType);
      res.status(201).json(
        await prisma.employeeDocument.create({
          data: { employeeId, kind: data.kind, title: data.title, fileKey, contentType: file.contentType, size: file.bytes.length, uploadedBy: who(res) },
          select: documentSelect,
        }),
      );
    } catch (e) {
      fail(res, e);
    }
  });

  router.get("/hr/documents/:id/file", async (req, res) => {
    const doc = await prisma.employeeDocument.findUnique({ where: { id: String(req.params.id) } });
    const file = doc && config.files ? await config.files.get(doc.fileKey) : null;
    if (!doc || !file) {
      res.status(404).json({ error: "Document introuvable" });
      return;
    }
    const ext = doc.contentType === "application/pdf" ? "pdf" : doc.contentType.split("/")[1];
    res.set("Content-Type", file.contentType);
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Disposition", `attachment; filename="document-${doc.id}.${ext}"`);
    res.send(Buffer.from(file.body instanceof Uint8Array ? file.body : new Uint8Array(file.body)));
  });

  router.delete("/hr/documents/:id", async (req, res) => {
    const doc = await prisma.employeeDocument.findUnique({ where: { id: String(req.params.id) }, select: { id: true, fileKey: true } });
    if (!doc) {
      res.status(404).json({ error: "Document introuvable" });
      return;
    }
    await prisma.employeeDocument.delete({ where: { id: doc.id } });
    await config.files?.delete(doc.fileKey).catch(() => {});
    res.status(204).end();
  });

  // ---------------------------------------------------------------- Paie

  async function payroll(month: string) {
    const slips = await prisma.payslip.findMany({
      where: { month },
      orderBy: { employee: { name: "asc" } },
      include: { employee: { select: { id: true, name: true, position: true, department: true, paymentMethod: true, paymentAccount: true } } },
    });
    const sum = (k: "baseSalary" | "absenceDeduction" | "bonus" | "deductions" | "net") => slips.reduce((s, p) => s + p[k], 0);
    return {
      month,
      payslips: slips,
      totals: { count: slips.length, base: sum("baseSalary"), absences: sum("absenceDeduction"), bonus: sum("bonus"), deductions: sum("deductions"), net: sum("net") },
      byStatus: Object.fromEntries(["DRAFT", "VALIDATED", "PAID"].map((s) => [s, slips.filter((p) => p.status === s).length])),
    };
  }

  router.get("/hr/payroll", async (req, res) => {
    const month = parseMonth(req.query.month) ?? parseMonth(monthOf(new Date()))!;
    res.json(await payroll(month.month));
  });

  // Prépare la paie du mois : un bulletin pour chaque employé payé ce mois-là (salaire de la fiche, retenue des
  // absences non payées acceptées). Les bulletins encore en brouillon sont recalculés (prime et retenues gardées).
  router.post("/hr/payroll/prepare", async (req, res) => {
    const month = parseMonth(req.body?.month);
    if (!month) {
      res.status(400).json({ error: "Mois invalide (AAAA-MM)" });
      return;
    }
    const [employees, existing] = await Promise.all([
      prisma.employee.findMany({
        where: { status: { not: "SUSPENDED" } },
        include: { leaves: { where: { status: "APPROVED", startDate: { lt: month.end }, endDate: { gte: month.start } } } },
      }),
      prisma.payslip.findMany({ where: { month: month.month } }),
    ]);
    const byEmployee = new Map(existing.map((p) => [p.employeeId, p]));
    let created = 0;
    let updated = 0;
    for (const e of employees) {
      if (!onPayroll(e, month)) continue;
      const unpaidDays = unpaidDaysInMonth(e.leaves, month);
      const slip = byEmployee.get(e.id);
      if (slip && slip.status !== "DRAFT") continue;
      const base = slip ? { bonus: slip.bonus, deductions: slip.deductions } : { bonus: 0, deductions: 0 };
      const absence = absenceDeduction(e.monthlySalary, unpaidDays);
      const values = { baseSalary: e.monthlySalary, unpaidDays, absenceDeduction: absence, net: payslipNet({ baseSalary: e.monthlySalary, absenceDeduction: absence, ...base }) };
      if (slip) {
        await prisma.payslip.update({ where: { id: slip.id }, data: values });
        updated++;
      } else {
        try {
          await prisma.payslip.create({ data: { employeeId: e.id, month: month.month, ...base, ...values } });
          created++;
        } catch (err) {
          if ((err as { code?: string }).code !== "P2002") throw err;
        }
      }
    }
    res.json({ created, updated, ...(await payroll(month.month)) });
  });

  router.patch("/hr/payslips/:id", async (req, res) => {
    try {
      const data = parse(payslipInput, req.body);
      const slip = await prisma.payslip.findUnique({ where: { id: String(req.params.id) } });
      if (!slip) throw new HttpError(404, "Bulletin introuvable");
      if (slip.status !== "DRAFT") throw new HttpError(409, "Bulletin déjà validé : rouvrez-le pour le modifier");
      const next = { ...slip, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
      if (data.baseSalary !== undefined) next.absenceDeduction = absenceDeduction(next.baseSalary, slip.unpaidDays);
      const { count } = await prisma.payslip.updateMany({
        where: { id: slip.id, status: "DRAFT" },
        data: { baseSalary: next.baseSalary, absenceDeduction: next.absenceDeduction, bonus: next.bonus, deductions: next.deductions, note: next.note, net: payslipNet(next) },
      });
      if (count === 0) throw new HttpError(409, "Bulletin déjà validé : rouvrez-le pour le modifier");
      res.json(await prisma.payslip.findUnique({ where: { id: slip.id } }));
    } catch (e) {
      fail(res, e);
    }
  });

  // Valider (le comptable peut alors payer) ou rouvrir un bulletin validé pas encore payé.
  for (const action of ["validate", "reopen"] as const) {
    router.post(`/hr/payslips/:id/${action}`, async (req, res) => {
      const validate = action === "validate";
      const { count } = await prisma.payslip.updateMany({
        where: { id: String(req.params.id), status: validate ? "DRAFT" : "VALIDATED" },
        data: validate ? { status: "VALIDATED", validatedBy: who(res), validatedAt: new Date() } : { status: "DRAFT", validatedBy: null, validatedAt: null },
      });
      if (count === 0) {
        res.status(409).json({ error: validate ? "Ce bulletin n'est plus un brouillon" : "Seul un bulletin validé et pas encore payé peut être rouvert" });
        return;
      }
      res.json(await prisma.payslip.findUnique({ where: { id: String(req.params.id) } }));
    });
  }

  // Valider tous les brouillons du mois d'un coup.
  router.post("/hr/payroll/validate", async (req, res) => {
    const month = parseMonth(req.body?.month);
    if (!month) {
      res.status(400).json({ error: "Mois invalide (AAAA-MM)" });
      return;
    }
    const { count } = await prisma.payslip.updateMany({ where: { month: month.month, status: "DRAFT" }, data: { status: "VALIDATED", validatedBy: who(res), validatedAt: new Date() } });
    res.json({ validated: count, ...(await payroll(month.month)) });
  });

  router.get("/hr/payroll/export", async (req, res) => {
    const month = parseMonth(req.query.month) ?? parseMonth(monthOf(new Date()))!;
    const { payslips } = await payroll(month.month);
    const rows = [
      ["Mois", "Employé", "Poste", "Service", "Salaire de base", "Jours non payés", "Retenue absences", "Prime", "Autres retenues", "Net à payer", "Paiement", "Compte", "État"],
      ...payslips.map((p) => [
        p.month,
        p.employee.name,
        p.employee.position,
        p.employee.department ?? "",
        p.baseSalary,
        p.unpaidDays,
        p.absenceDeduction,
        p.bonus,
        p.deductions,
        p.net,
        p.employee.paymentMethod,
        p.employee.paymentAccount ?? "",
        p.status,
      ]),
    ];
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="paie-${month.month}.csv"`);
    res.send(csvFile(rows));
  });

  return router;
}
