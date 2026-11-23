import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ensureTrips, isDate, isoWeekday, isRoundTrip, isTime, monthCovered, monthlyFeeFor, monthState, newCode, parseSchedule, plannedLegs, scheduleConflicts } from "./school.js";

const fees = { schoolMonthlyFee: 30000, schoolOneWayFee: 18000, studentMonthlyFee: 25000, studentOneWayFee: 15000 };

describe("horaires du transport scolaire", () => {
  it("vérifie heures et dates sans expression régulière", () => {
    expect(isTime("06:45")).toBe(true);
    expect(isTime("24:00")).toBe(false);
    expect(isTime("6:45")).toBe(false);
    expect(isDate("2026-11-23")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("23/11/2026")).toBe(false);
  });

  it("garde les jours remplis et refuse un retour avant l'aller", () => {
    expect(parseSchedule({ "1": { go: "06:45", back: "17:00" }, "3": { go: "06:45", back: "" }, "6": {} })).toEqual({ "1": { go: "06:45", back: "17:00" }, "3": { go: "06:45" } });
    expect(parseSchedule({ "1": { go: "12:00", back: "08:00" } })).toBe("L'heure de retour doit suivre l'heure d'aller");
    expect(parseSchedule({ "8": { go: "07:00" } })).toBe("Jour de la semaine invalide");
    expect(parseSchedule({ "1": { go: "03:00" } })).toBe("Les trajets se font entre 5 h et 21 h");
    expect(parseSchedule({})).toBe("Choisissez au moins un jour et une heure");
  });

  it("tarif aller-retour ou simple, écolier ou étudiant", () => {
    const round = { "1": { go: "06:45", back: "17:00" } };
    const oneWay = { "1": { go: "06:45" }, "2": { go: "06:45" } };
    expect(isRoundTrip(round)).toBe(true);
    expect(isRoundTrip(oneWay)).toBe(false);
    expect(monthlyFeeFor("SCHOOL", round, fees)).toBe(30000);
    expect(monthlyFeeFor("SCHOOL", oneWay, fees)).toBe(18000);
    expect(monthlyFeeFor("STUDENT", round, fees)).toBe(25000);
    expect(monthlyFeeFor("STUDENT", { "2": { back: "18:00" } }, fees)).toBe(15000);
  });

  it("codes de remise à 4 chiffres", () => {
    for (let i = 0; i < 50; i++) {
      const code = newCode();
      expect(code).toHaveLength(4);
      expect(code).not.toBe("0000");
    }
  });

  it("jour de la semaine ISO", () => {
    expect(isoWeekday("2026-11-23")).toBe(1); // lundi
    expect(isoWeekday("2026-11-29")).toBe(7); // dimanche
  });
});

describe("trajets prévus", () => {
  const pass = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    kind: "SCHOOL",
    status: "ACTIVE",
    driverId: "d1",
    startsOn: null as string | null,
    schedule: JSON.stringify({ "1": { go: "06:45", back: "17:00" }, "3": { go: "06:45", back: "12:00" } }),
    payments: [{ month: "2026-11" }],
    absences: [] as { date: string; leg: string }[],
    ...over,
  });

  it("aller et retour un lundi payé", () => {
    expect(plannedLegs(pass(), "2026-11-23", [], 5)).toEqual([
      { leg: "GO", time: "06:45" },
      { leg: "BACK", time: "17:00" },
    ]);
  });

  it("rien un jour sans créneau, férié, avant le début, sans conducteur ou en pause", () => {
    expect(plannedLegs(pass(), "2026-11-24", [], 5)).toEqual([]);
    expect(plannedLegs(pass(), "2026-11-23", [{ date: "2026-11-23", kind: "ALL" }], 5)).toEqual([]);
    expect(plannedLegs(pass(), "2026-11-23", [{ date: "2026-11-23", kind: "STUDENT" }], 5)).toHaveLength(2);
    expect(plannedLegs(pass({ startsOn: "2026-11-30" }), "2026-11-23", [], 5)).toEqual([]);
    expect(plannedLegs(pass({ driverId: null }), "2026-11-23", [], 5)).toEqual([]);
    expect(plannedLegs(pass({ status: "PAUSED" }), "2026-11-23", [], 5)).toEqual([]);
  });

  it("absence d'une jambe ou de la journée", () => {
    expect(plannedLegs(pass({ absences: [{ date: "2026-11-23", leg: "GO" }] }), "2026-11-23", [], 5)).toEqual([{ leg: "BACK", time: "17:00" }]);
    expect(plannedLegs(pass({ absences: [{ date: "2026-11-23", leg: "BOTH" }] }), "2026-11-23", [], 5)).toEqual([]);
  });

  it("mois non payé : trajets pendant les jours de grâce seulement", () => {
    expect(monthCovered("2026-12-04", [], 5)).toBe(true);
    expect(monthCovered("2026-12-07", [], 5)).toBe(false);
    expect(monthCovered("2026-12-07", ["2026-12"], 5)).toBe(true);
    expect(plannedLegs(pass({ payments: [] }), "2026-11-23", [], 5)).toEqual([]);
  });

  it("état du mois pour le parent", () => {
    const now = new Date("2026-11-23T08:00:00Z");
    expect(monthState({ monthlyFee: 30000, status: "ACTIVE", payments: [] }, 5, now)).toMatchObject({ month: "2026-11", paid: false, inGrace: false, suspended: true });
    expect(monthState({ monthlyFee: 30000, status: "ACTIVE", payments: [{ month: "2026-11", amount: 30000 }] }, 5, now)).toMatchObject({ paid: true, suspended: false, lastPaidMonth: "2026-11" });
    expect(monthState({ monthlyFee: 30000, status: "ACTIVE", payments: [] }, 5, new Date("2026-12-02T08:00:00Z"))).toMatchObject({ inGrace: true, suspended: false });
  });

  it("conflits de créneaux d'un même conducteur (moins de 30 min)", () => {
    const mine = { "1": { go: "06:45", back: "17:00" } };
    expect(scheduleConflicts(mine, [{ riderName: "Ama", schedule: JSON.stringify({ "1": { go: "07:00" } }) }])).toEqual(["lundi 06:45 : Ama"]);
    expect(scheduleConflicts(mine, [{ riderName: "Kofi", schedule: JSON.stringify({ "1": { go: "07:30" }, "2": { go: "06:45" } }) }])).toEqual([]);
  });
});

describe("création des trajets du jour", () => {
  function fake(existing: { passId: string; leg: string }[] = []) {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      schoolPass: {
        findMany: async () => [
          { id: "p1", kind: "SCHOOL", status: "ACTIVE", driverId: "d1", startsOn: null, schedule: JSON.stringify({ "1": { go: "06:45", back: "17:00" } }), payments: [{ month: "2026-11" }], absences: [] },
          { id: "p2", kind: "STUDENT", status: "ACTIVE", driverId: "d2", startsOn: null, schedule: JSON.stringify({ "1": { go: "07:30" } }), payments: [{ month: "2026-11" }], absences: [] },
        ],
      },
      schoolHoliday: { findMany: async () => [] },
      settings: { findFirst: async () => ({ schoolGraceDays: 5 }) },
      schoolTrip: {
        findMany: async () => existing,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        },
      },
    } as unknown as PrismaClient;
    return { prisma, created };
  }

  it("crée aller et retour avec l'heure en UTC (Lomé), sans doublon", async () => {
    const { prisma, created } = fake([{ passId: "p1", leg: "GO" }]);
    expect(await ensureTrips(prisma, "2026-11-23")).toBe(2);
    expect(created.map((t) => `${t.passId}:${t.leg}`)).toEqual(["p1:BACK", "p2:GO"]);
    expect((created[0].scheduledAt as Date).toISOString()).toBe("2026-11-23T17:00:00.000Z");
    expect(created[0].driverId).toBe("d1");
  });
});
