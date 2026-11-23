import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { accountBalances, categoryFits, journalTotals, periodOf } from "./accounting.js";
import { createApp } from "./app.js";
import {
  absenceDeduction,
  csvCell,
  csvFile,
  decodeDocument,
  leaveBalance,
  onPayroll,
  parseDay,
  parseMonth,
  payslipNet,
  unpaidDaysInMonth,
  upcomingDeadlines,
  workingDays,
} from "./hr.js";
import { notificationCategoriesFor, staffMay, type TeamRole } from "./team.js";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("droits des ressources humaines", () => {
  it("n'ouvre que l'outil RH, les notifications et le menu", () => {
    for (const [m, p] of [
      ["GET", "/hr/summary"],
      ["POST", "/hr/employees"],
      ["PATCH", "/hr/employees/e1"],
      ["POST", "/hr/employees/e1/leaves"],
      ["POST", "/hr/payroll/prepare"],
      ["POST", "/hr/payslips/p1/validate"],
      ["GET", "/me"],
      ["GET", "/nav"],
      ["GET", "/notifications"],
      ["POST", "/push/subscribe"],
    ]) {
      expect(staffMay("HR", m, p), `${m} ${p}`).toBe(true);
    }
    for (const [m, p] of [
      ["GET", "/dashboard"],
      ["GET", "/orders"],
      ["GET", "/dispatch"],
      ["GET", "/drivers"],
      ["PATCH", "/drivers/d1"],
      ["GET", "/finance/cash"],
      ["GET", "/report"],
      ["GET", "/accounting/entries"],
      ["POST", "/accounting/payslips/p1/pay"],
      ["GET", "/settings"],
      ["GET", "/team"],
      ["POST", "/team"],
      ["GET", "/restaurants"],
      ["GET", "/requests"],
      ["GET", "/crm/tasks"],
      ["GET", "/leases"],
    ]) {
      expect(staffMay("HR", m, p), `${m} ${p}`).toBe(false);
    }
  });
});

describe("droits du comptable", () => {
  it("ouvre la comptabilité, les finances, le rapport et le leasing en consultation", () => {
    for (const [m, p] of [
      ["GET", "/accounting/overview"],
      ["POST", "/accounting/entries"],
      ["POST", "/accounting/payslips/p1/pay"],
      ["GET", "/finance/cash"],
      ["POST", "/finance/cash"],
      ["PATCH", "/finance/settlements/s1"],
      ["GET", "/report"],
      ["GET", "/leases"],
      ["GET", "/leases/summary"],
      ["GET", "/leases/c1"],
      ["GET", "/lease-payments"],
      ["POST", "/lease-payments/x/review"],
      ["POST", "/leases/c1/payments"],
      ["GET", "/me"],
      ["GET", "/notifications"],
    ]) {
      expect(staffMay("ACCOUNTANT", m, p), `${m} ${p}`).toBe(true);
    }
    for (const [m, p] of [
      ["GET", "/hr/employees"],
      ["PATCH", "/hr/payslips/p1"],
      ["POST", "/hr/payslips/p1/validate"],
      ["GET", "/orders"],
      ["GET", "/dispatch"],
      ["GET", "/dashboard"],
      ["POST", "/leases"],
      ["POST", "/leases/c1/end"],
      ["PATCH", "/leases/c1"],
      ["GET", "/settings"],
      ["PATCH", "/settings"],
      ["GET", "/team"],
      ["PATCH", "/drivers/d1"],
      ["GET", "/requests"],
    ]) {
      expect(staffMay("ACCOUNTANT", m, p), `${m} ${p}`).toBe(false);
    }
  });

  it("reçoit les notifications d'argent seulement ; les RH aucune des opérations", () => {
    expect(notificationCategoriesFor("ACCOUNTANT")).toEqual(["FINANCE"]);
    expect(notificationCategoriesFor("HR")).toEqual([]);
  });
});

describe("rôles existants inchangés", () => {
  it("le directeur garde tout, l'adjoint consulte RH et comptabilité sans les modifier", () => {
    for (const p of ["/hr/employees", "/accounting/entries", "/team", "/settings"]) {
      expect(staffMay("DIRECTOR", "POST", p)).toBe(true);
      expect(staffMay("DEPUTY", "GET", p)).toBe(true);
    }
    expect(staffMay("DEPUTY", "POST", "/hr/employees")).toBe(false);
    expect(staffMay("DEPUTY", "POST", "/accounting/entries")).toBe(false);
    expect(staffMay("DEPUTY", "POST", "/orders")).toBe(true);
  });

  it("la managerin et le dispatcheur n'ont ni RH ni comptabilité, et gardent leurs écrans", () => {
    for (const role of ["MANAGER", "DISPATCHER"] as TeamRole[]) {
      expect(staffMay(role, "GET", "/hr/employees")).toBe(false);
      expect(staffMay(role, "GET", "/accounting/overview")).toBe(false);
      expect(staffMay(role, "GET", "/dispatch")).toBe(true);
      expect(staffMay(role, "PATCH", "/orders/o1")).toBe(true);
      expect(staffMay(role, "GET", "/notifications")).toBe(true);
    }
    expect(staffMay("MANAGER", "GET", "/requests")).toBe(true);
  });

  it("un rôle inconnu n'ouvre rien", () => {
    expect(staffMay("STAGIAIRE" as TeamRole, "GET", "/orders")).toBe(false);
  });
});

describe("congés et paie", () => {
  it("compte les jours ouvrables du lundi au samedi", () => {
    // Lundi 2 au dimanche 8 novembre 2026 : 6 jours.
    expect(workingDays(day("2026-11-02"), day("2026-11-08"))).toBe(6);
    expect(workingDays(day("2026-11-08"), day("2026-11-08"))).toBe(0);
    expect(workingDays(day("2026-11-10"), day("2026-11-09"))).toBe(0);
  });

  it("vérifie les dates et les mois saisis", () => {
    expect(parseDay("2026-11-22")?.toISOString()).toBe("2026-11-22T00:00:00.000Z");
    expect(parseDay("2026-02-31")).toBeNull();
    expect(parseDay("22/11/2026")).toBeNull();
    expect(parseDay(undefined)).toBeNull();
    expect(parseMonth("2026-12")).toMatchObject({ month: "2026-12", end: day("2027-01-01") });
    expect(parseMonth("2026-13")).toBeNull();
  });

  it("solde des congés payés : droit annuel au prorata de l'arrivée, pris et demandés", () => {
    const leaves = [
      { kind: "PAID", status: "APPROVED", startDate: day("2026-08-03"), endDate: day("2026-08-08") },
      { kind: "PAID", status: "REQUESTED", startDate: day("2026-12-21"), endDate: day("2026-12-22") },
      { kind: "SICK", status: "APPROVED", startDate: day("2026-09-01"), endDate: day("2026-09-03") },
      { kind: "PAID", status: "REJECTED", startDate: day("2026-10-01"), endDate: day("2026-10-02") },
    ];
    expect(leaveBalance({ leaveDaysPerYear: 30, startDate: day("2024-01-10") }, leaves, day("2026-11-22"))).toEqual({ year: 2026, entitled: 30, taken: 6, requested: 2, remaining: 24 });
    // Arrivé le 1er juillet : la moitié de l'année.
    expect(leaveBalance({ leaveDaysPerYear: 30, startDate: day("2026-07-01") }, [], day("2026-11-22")).entitled).toBe(15);
  });

  it("retient les absences non payées acceptées du mois (salaire / 26 par jour)", () => {
    const month = parseMonth("2026-11")!;
    const leaves = [
      { kind: "UNPAID", status: "APPROVED", startDate: day("2026-10-30"), endDate: day("2026-11-03") }, // 2 et 3 novembre
      { kind: "ABSENCE", status: "APPROVED", startDate: day("2026-11-20"), endDate: day("2026-11-20") },
      { kind: "UNPAID", status: "REQUESTED", startDate: day("2026-11-24"), endDate: day("2026-11-25") },
      { kind: "PAID", status: "APPROVED", startDate: day("2026-11-10"), endDate: day("2026-11-12") },
    ];
    expect(unpaidDaysInMonth(leaves, month)).toBe(3);
    expect(absenceDeduction(78_000, 3)).toBe(9_000);
    expect(absenceDeduction(78_000, 40)).toBe(78_000);
    expect(payslipNet({ baseSalary: 78_000, absenceDeduction: 9_000, bonus: 5_000, deductions: 2_000 })).toBe(72_000);
    expect(payslipNet({ baseSalary: 1_000, absenceDeduction: 0, bonus: 0, deductions: 5_000 })).toBe(0);
  });

  it("met dans la paie les employés présents ce mois-là", () => {
    const month = parseMonth("2026-11")!;
    const e = (over: Partial<{ status: string; startDate: Date; leftAt: Date | null; endDate: Date | null }>) => ({ status: "ACTIVE", startDate: day("2026-01-01"), leftAt: null, endDate: null, ...over });
    expect(onPayroll(e({}), month)).toBe(true);
    expect(onPayroll(e({ startDate: day("2026-12-01") }), month)).toBe(false);
    expect(onPayroll(e({ status: "LEFT", leftAt: day("2026-11-15") }), month)).toBe(true);
    expect(onPayroll(e({ status: "LEFT", leftAt: day("2026-10-31") }), month)).toBe(false);
    expect(onPayroll(e({ status: "SUSPENDED" }), month)).toBe(false);
  });

  it("signale les fins de contrat et de période d'essai des 30 prochains jours", () => {
    const now = day("2026-11-22");
    const list = upcomingDeadlines(
      [
        { id: "a", name: "Afi", status: "ACTIVE", contractType: "CDD", endDate: day("2026-12-10"), trialEndDate: null },
        { id: "b", name: "Kossi", status: "ACTIVE", contractType: "CDI", endDate: null, trialEndDate: day("2026-11-30") },
        { id: "c", name: "Yao", status: "ACTIVE", contractType: "CDD", endDate: day("2027-03-01"), trialEndDate: null },
        { id: "d", name: "Parti", status: "LEFT", contractType: "CDD", endDate: day("2026-11-25"), trialEndDate: null },
      ],
      now,
    );
    expect(list.map((d) => [d.name, d.kind])).toEqual([
      ["Kossi", "TRIAL_END"],
      ["Afi", "CONTRACT_END"],
    ]);
  });

  it("n'accepte que des PDF et des photos comme documents", () => {
    expect(decodeDocument(`data:application/pdf;base64,${btoa("%PDF-1.4")}`)).toMatchObject({ contentType: "application/pdf" });
    expect(decodeDocument(`data:text/html;base64,${btoa("<script>")}`)).toBeNull();
    expect(decodeDocument("pas un fichier")).toBeNull();
  });

  it("écrit des CSV lisibles par Excel, sans formule exécutable", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-5000)).toBe("-5000");
    expect(csvCell("Loyer; bureau")).toBe('"Loyer; bureau"');
    expect(csvFile([["a", 1]])).toBe("﻿a;1\r\n");
  });
});

describe("comptabilité", () => {
  const entries = [
    { direction: "IN", category: "SUBSCRIPTIONS", amount: 50_000, accountId: "caisse", voidedAt: null },
    { direction: "OUT", category: "RENT", amount: 30_000, accountId: "banque", voidedAt: null },
    { direction: "OUT", category: "RENT", amount: 99_999, accountId: "banque", voidedAt: day("2026-11-20") },
    { direction: "OUT", category: "TRANSFER", amount: 20_000, accountId: "caisse", voidedAt: null },
    { direction: "IN", category: "TRANSFER", amount: 20_000, accountId: "banque", voidedAt: null },
  ];

  it("calcule les soldes des comptes sans les écritures annulées", () => {
    const [caisse, banque] = accountBalances(
      [
        { id: "caisse", openingBalance: 10_000 },
        { id: "banque", openingBalance: 100_000 },
      ],
      entries,
    );
    expect(caisse.balance).toBe(40_000);
    expect(banque.balance).toBe(90_000);
  });

  it("totaux de la période : recettes, dépenses et résultat, virements à part", () => {
    expect(journalTotals(entries)).toMatchObject({ income: 50_000, expense: 30_000, result: 20_000, transfers: 20_000 });
  });

  it("refuse une catégorie de dépense pour une recette", () => {
    expect(categoryFits("IN", "SUBSCRIPTIONS")).toBe(true);
    expect(categoryFits("IN", "RENT")).toBe(false);
    expect(categoryFits("OUT", "SALARIES")).toBe(true);
  });

  it("période par défaut : le mois en cours ; deux ans au plus", () => {
    expect(periodOf(null, null, day("2026-11-22"))).toMatchObject({ from: "2026-11-01", to: "2026-11-30", end: day("2026-12-01") });
    expect(periodOf(day("2026-11-10"), day("2026-11-01"))).toBeNull();
    expect(periodOf(day("2020-01-01"), day("2026-01-01"))).toBeNull();
  });
});

// Parcours avec une base en mémoire : les RH valident un bulletin, le comptable le paie une seule fois.
describe("paie : les RH préparent, le comptable paie", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const members = [
    { id: "rh", name: "Adjo", email: "rh@zedeka.tg", passwordHash: bcrypt.hashSync("ressources-2026", 4), role: "HR", active: true },
    { id: "cpt", name: "Mawuli", email: "compta@zedeka.tg", passwordHash: bcrypt.hashSync("comptable-2026", 4), role: "ACCOUNTANT", active: true },
  ];
  const slip = { id: "p1", employeeId: "e1", month: "2026-11", net: 80_000, status: "DRAFT", employee: { name: "Kossi" } } as Record<string, unknown>;
  const ledger: Record<string, unknown>[] = [];
  const matches = (where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => slip[k] === v);
  const prisma = {
    teamMember: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => members.find((m) => m.id === where.id || m.email === where.email) ?? null,
      update: async () => ({}),
    },
    employeeLeave: { count: async () => 2 },
    payslip: {
      count: async () => 0,
      findUnique: async () => ({ ...slip }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(slip, data);
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(slip, data),
    },
    financeAccount: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "caisse" ? { active: true } : null) },
    ledgerEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const entry = { id: `l${ledger.length + 1}`, ...data };
        ledger.push(entry);
        return entry;
      },
    },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });
  const login = async (email: string, password: string) => {
    const res = await request(app).post("/api/admin/login").send({ email, password }).expect(200);
    return { authorization: `Bearer ${res.body.token}` };
  };

  it("RH : menu réduit, pas de finances ; comptable : pas de fiches RH", async () => {
    const rh = await login("rh@zedeka.tg", "ressources-2026");
    expect((await request(app).get("/api/admin/nav").set(rh).expect(200)).body).toEqual({ hrLeaves: 2 });
    await request(app).get("/api/admin/finance/cash").set(rh).expect(403);
    await request(app).post("/api/admin/accounting/payslips/p1/pay").set(rh).send({ accountId: "caisse" }).expect(403);
    const cpt = await login("compta@zedeka.tg", "comptable-2026");
    await request(app).get("/api/admin/hr/employees").set(cpt).expect(403);
    await request(app).post("/api/admin/hr/payslips/p1/validate").set(cpt).expect(403);
    await request(app).get("/api/admin/orders").set(cpt).expect(403);
  });

  it("un brouillon ne se paie pas ; validé, il se paie une fois avec son écriture « Salaires »", async () => {
    const rh = await login("rh@zedeka.tg", "ressources-2026");
    const cpt = await login("compta@zedeka.tg", "comptable-2026");
    const early = await request(app).post("/api/admin/accounting/payslips/p1/pay").set(cpt).send({ accountId: "caisse" }).expect(409);
    expect(early.body.error).toMatch(/validé/);
    await request(app).post("/api/admin/hr/payslips/p1/validate").set(rh).expect(200);
    expect(slip.status).toBe("VALIDATED");
    expect(slip.validatedBy).toBe("Adjo");
    await request(app).post("/api/admin/accounting/payslips/p1/pay").set(cpt).send({ accountId: "inconnu" }).expect(404);
    await request(app).post("/api/admin/accounting/payslips/p1/pay").set(cpt).send({ accountId: "caisse", reference: "TM-123" }).expect(200);
    expect(slip).toMatchObject({ status: "PAID", paidBy: "Mawuli", ledgerEntryId: "l1" });
    expect(ledger[0]).toMatchObject({ direction: "OUT", category: "SALARIES", amount: 80_000, accountId: "caisse", source: "PAYROLL", sourceId: "p1", reference: "TM-123", createdBy: "Mawuli" });
    const twice = await request(app).post("/api/admin/accounting/payslips/p1/pay").set(cpt).send({ accountId: "caisse" }).expect(409);
    expect(twice.body.error).toMatch(/déjà payé/);
    expect(ledger).toHaveLength(1);
    // Payé : les RH ne peuvent plus le rouvrir.
    await request(app).post("/api/admin/hr/payslips/p1/reopen").set(rh).expect(409);
  });
});
