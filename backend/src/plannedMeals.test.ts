import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { silentNotifier } from "./notify.js";
import { nextDelivery, parseDays, runPlannedMeals, scheduleError } from "./plannedMeals.js";

const at = (iso: string) => new Date(iso);

describe("repas planifiés : calendrier", () => {
  it("une fois : la date prévue tant qu'elle n'est pas passée", () => {
    const plan = { kind: "ONCE", deliverAt: at("2026-11-24T12:30:00Z"), deliverTime: "12:30", days: null, endsAt: null };
    expect(nextDelivery(plan, at("2026-11-24T10:00:00Z"))).toEqual(at("2026-11-24T12:30:00Z"));
    expect(nextDelivery(plan, at("2026-11-24T12:30:00Z"))).toBeNull();
  });

  it("formule cantine : jour suivant de la liste, jusqu'à la fin", () => {
    // 2026-11-23 est un lundi. Lundi, mercredi, vendredi à 12:00.
    const plan = { kind: "WEEKLY", deliverAt: null, deliverTime: "12:00", days: "1,3,5", endsAt: at("2026-11-28T00:00:00Z") };
    expect(nextDelivery(plan, at("2026-11-23T08:00:00Z"))).toEqual(at("2026-11-23T12:00:00Z"));
    expect(nextDelivery(plan, at("2026-11-23T12:00:00Z"))).toEqual(at("2026-11-25T12:00:00Z"));
    expect(nextDelivery(plan, at("2026-11-25T12:00:00Z"))).toEqual(at("2026-11-27T12:00:00Z"));
    expect(nextDelivery(plan, at("2026-11-27T12:00:00Z"))).toBeNull();
  });

  it("jours lus sans les valeurs invalides", () => {
    expect(parseDays("1,2,x,9,5")).toEqual([1, 2, 5]);
    expect(parseDays(null)).toEqual([]);
  });

  it("au moins 1 h 30 et au plus 7 jours à l'avance", () => {
    const now = at("2026-11-23T08:00:00Z");
    expect(scheduleError("ONCE", at("2026-11-23T09:00:00Z"), now)).toBe("Planifiez au moins 1 h 30 à l'avance");
    expect(scheduleError("ONCE", at("2026-12-05T12:00:00Z"), now)).toBe("Planifiez au plus 7 jours à l'avance");
    expect(scheduleError("ONCE", at("2026-11-23T12:00:00Z"), now)).toBeNull();
    expect(scheduleError("WEEKLY", null, now)).toBe("Aucune livraison possible avec ces jours et cette heure");
  });
});

describe("repas planifiés : tâche de chaque minute", () => {
  function fakeDb(plan: Record<string, unknown>, opts: { restaurantClosed?: boolean } = {}) {
    const runs: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      plannedMeal: {
        findMany: async () => [plan],
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          Object.assign(plan, data);
          return plan;
        },
      },
      plannedMealRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (runs.some((r) => +(r.deliverAt as Date) === +(data.deliverAt as Date))) throw Object.assign(new Error("unique"), { code: "P2002" });
          const row = { id: `run${runs.length}`, ...data };
          runs.push(row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(runs.find((r) => r.id === where.id)!, data),
      },
      customer: { findUnique: async () => ({ deletedAt: null }) },
      restaurant: {
        findUnique: async () => ({
          id: "r1",
          name: "Chez Ama",
          deletedAt: null,
          active: !opts.restaurantClosed,
          temporarilyClosed: false,
          closedUntil: null,
          openingHours: [],
        }),
      },
    } as unknown as PrismaClient;
    return { prisma, runs, updates };
  }

  const base = {
    id: "p1",
    customerId: "c1",
    restaurantId: "r1",
    kind: "WEEKLY",
    items: "[]",
    customerName: "Afi",
    customerPhone: "90112233",
    address: "Bureau",
    latitude: 6.13,
    longitude: 1.22,
    note: null,
    paymentMethod: "CASH",
    deliverTime: "12:00",
    days: "1,2",
    deliverAt: null,
    endsAt: at("2026-12-31T00:00:00Z"),
    status: "ACTIVE",
  };

  it("restaurant fermé : livraison sautée, erreur notée, la suivante reste prévue", async () => {
    const plan = { ...base, nextRunAt: at("2026-11-23T12:00:00Z") };
    const { prisma, runs } = fakeDb(plan, { restaurantClosed: true });
    await runPlannedMeals(prisma, silentNotifier, at("2026-11-23T11:00:00Z"));
    expect(runs).toHaveLength(1);
    expect(runs[0].error).toBe("Ce restaurant ne prend pas de commandes pour le moment.");
    expect(plan.nextRunAt).toEqual(at("2026-11-24T12:00:00Z"));
    expect(plan.status).toBe("ACTIVE");
  });

  it("une livraison déjà traitée n'est jamais commandée deux fois", async () => {
    const plan = { ...base, nextRunAt: at("2026-11-23T12:00:00Z") };
    const { prisma, runs } = fakeDb(plan, { restaurantClosed: true });
    await runPlannedMeals(prisma, silentNotifier, at("2026-11-23T11:00:00Z"));
    plan.nextRunAt = at("2026-11-23T12:00:00Z");
    await runPlannedMeals(prisma, silentNotifier, at("2026-11-23T11:01:00Z"));
    expect(runs).toHaveLength(1);
    expect(plan.nextRunAt).toEqual(at("2026-11-24T12:00:00Z"));
  });

  it("trop tard (moins de 20 min) : sautée ; repas unique terminé", async () => {
    const plan = { ...base, kind: "ONCE", days: null, deliverAt: at("2026-11-23T12:00:00Z"), nextRunAt: at("2026-11-23T12:00:00Z") };
    const { prisma, runs } = fakeDb(plan);
    await runPlannedMeals(prisma, silentNotifier, at("2026-11-23T11:50:00Z"));
    expect(runs[0].error).toMatch(/trop tard/);
    expect(plan.status).toBe("DONE");
    expect(plan.nextRunAt).toBeNull();
  });
});
