import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { Notifier } from "./notify.js";
import { leaseBalance, leaseBlockError, leaseEligibilityError, leasingPerDay, parseStartDate, remindLeases } from "./lease.js";

const at = (iso: string) => new Date(iso);
const contract = (over: Partial<{ dailyRate: number; startsAt: Date; status: string; endedAt: Date | null }> = {}) => ({
  dailyRate: 1000,
  startsAt: at("2026-11-20T00:00:00Z"),
  status: "ACTIVE",
  endedAt: null,
  ...over,
});
const paid = (amount: number, status = "CONFIRMED") => ({ amount, status });

describe("compte du leasing", () => {
  it("le premier jour : à payer aujourd'hui, pas encore en retard", () => {
    const b = leaseBalance(contract(), [], at("2026-11-20T15:00:00Z"));
    expect(b).toMatchObject({ state: "DUE_TODAY", daysDue: 1, paidDays: 0, paidUntil: null, lateDays: 0, owed: 1000 });
  });

  it("jours passés non payés : en retard, le jour en cours compté dans le montant", () => {
    const b = leaseBalance(contract(), [paid(1000)], at("2026-11-23T09:00:00Z"));
    // 20, 21, 22, 23 dus ; le 20 payé : 21 et 22 en retard, 23 à payer aujourd'hui.
    expect(b).toMatchObject({ state: "LATE", daysDue: 4, paidDays: 1, paidUntil: "2026-11-20", lateDays: 2, owed: 3000 });
  });

  it("payé d'avance : à jour, avec un crédit", () => {
    const b = leaseBalance(contract({ dailyRate: 2000 }), [paid(10_000), paid(4000, "PENDING"), paid(2000, "REJECTED")], at("2026-11-21T12:00:00Z"));
    expect(b).toMatchObject({ state: "PAID", paidDays: 5, paidUntil: "2026-11-24", lateDays: 0, owed: 0, credit: 6000 });
  });

  it("contrat qui commence plus tard : rien n'est dû", () => {
    const b = leaseBalance(contract({ startsAt: at("2026-11-25T00:00:00Z") }), [], at("2026-11-22T12:00:00Z"));
    expect(b).toMatchObject({ state: "PAID", daysDue: 0, owed: 0, lateDays: 0 });
  });

  it("moto rendue : les jours s'arrêtent au retour, le reste dû est en retard", () => {
    const ended = contract({ status: "ENDED", endedAt: at("2026-11-22T10:00:00Z") });
    expect(leaseBalance(ended, [paid(1000)], at("2026-12-10T00:00:00Z"))).toMatchObject({ state: "LATE", daysDue: 3, lateDays: 2, owed: 2000 });
    expect(leaseBalance(ended, [paid(3000)], at("2026-12-10T00:00:00Z"))).toMatchObject({ state: "ENDED", owed: 0, lateDays: 0 });
  });

  it("revenu par jour : somme des prix des contrats en cours", () => {
    expect(leasingPerDay([{ dailyRate: 1000 }, { dailyRate: 2000 }, { dailyRate: 2000 }])).toBe(5000);
  });

  it("date de début : aujourd'hui par défaut, à moins d'un mois", () => {
    const now = at("2026-11-22T18:30:00Z");
    expect(parseStartDate(undefined, now).toISOString()).toBe("2026-11-22T00:00:00.000Z");
    expect(parseStartDate("2026-11-01", now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(() => parseStartDate("2026-01-01", now)).toThrow("moins d'un mois");
    expect(() => parseStartDate("22/11/2026", now)).toThrow("invalide");
  });
});

type Driver = { id: string; status: string; deletedAt: Date | null; employment: string; name: string };
type Contract = ReturnType<typeof contract> & { id: string; driverId: string; plate: string; remindedOn: string | null; staffAlertedAt: Date | null; payments: { amount: number; status: string }[] };

function setup(contracts: Contract[], drivers: Driver[], settings = { leaseBlockDays: 0 }) {
  const fits = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => row[k] === v);
  const pushes: { to: string; title: string }[] = [];
  const prisma = {
    settings: { findUnique: async () => settings, upsert: async () => settings, findFirst: async () => settings },
    driver: { findUnique: async ({ where }: { where: { id: string } }) => drivers.find((d) => d.id === where.id) ?? null },
    leaseContract: {
      count: async ({ where }: { where: Record<string, unknown> }) => contracts.filter((c) => fits(c, where)).length,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        contracts.filter((c) => fits(c, where)).map((c) => ({ ...c, driver: { name: drivers.find((d) => d.id === c.driverId)?.name ?? "" } })),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Contract> }) => Object.assign(contracts.find((c) => c.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Contract> }) => {
        const rows = contracts.filter((c) => fits(c, where));
        rows.forEach((c) => Object.assign(c, data));
        return { count: rows.length };
      },
    },
  } as unknown as PrismaClient;
  const notifier = {
    push: async (_role: string, to: string, p: { title: string }) => void pushes.push({ to, title: p.title }),
    staff: async (_cat: string, p: { title: string }) => void pushes.push({ to: "staff", title: p.title }),
  } as unknown as Notifier;
  return { prisma, notifier, pushes, contracts };
}

const drivers: Driver[] = [
  { id: "kofi", status: "APPROVED", deletedAt: null, employment: "FREELANCE", name: "Kofi" },
  { id: "ama", status: "APPROVED", deletedAt: null, employment: "STAFF", name: "Ama" },
  { id: "yao", status: "PENDING", deletedAt: null, employment: "FREELANCE", name: "Yao" },
  { id: "efi", status: "APPROVED", deletedAt: null, employment: "FREELANCE", name: "Efi" },
];
const lease = (over: Partial<Contract>): Contract => ({ ...contract(), id: "c1", driverId: "kofi", plate: "TG-1000-A", remindedOn: null, staffAlertedAt: null, payments: [], ...over });

describe("qui peut louer une moto", () => {
  it("livreur indépendant validé, sans contrat en cours, plaque libre", async () => {
    const { prisma } = setup([lease({ driverId: "kofi", plate: "TG-1000-A" })], drivers);
    expect(await leaseEligibilityError(prisma, "efi", "TG-2000-B")).toBeNull();
    expect(await leaseEligibilityError(prisma, "kofi", "TG-2000-B")).toMatch(/déjà une moto/);
    expect(await leaseEligibilityError(prisma, "efi", "TG-1000-A")).toMatch(/déjà louée/);
    expect(await leaseEligibilityError(prisma, "ama", "TG-2000-B")).toMatch(/salariés/);
    expect(await leaseEligibilityError(prisma, "yao", "TG-2000-B")).toMatch(/validés/);
    expect(await leaseEligibilityError(prisma, "personne", "TG-2000-B")).toBe("Livreur introuvable");
  });
});

describe("blocage en cas de retard", () => {
  const now = at("2026-11-25T10:00:00Z"); // 20 → 25 : 5 jours passés non payés
  it("désactivé par défaut (0 jour)", async () => {
    const { prisma } = setup([lease({})], drivers);
    expect(await leaseBlockError(prisma, "kofi", now)).toBeNull();
  });
  it("bloque à partir du nombre de jours réglé", async () => {
    expect(await leaseBlockError(setup([lease({})], drivers, { leaseBlockDays: 5 }).prisma, "kofi", now)).toMatch(/5 jour\(s\).*6 000 FCFA/);
    expect(await leaseBlockError(setup([lease({})], drivers, { leaseBlockDays: 6 }).prisma, "kofi", now)).toBeNull();
    expect(await leaseBlockError(setup([lease({ payments: [paid(5000)] })], drivers, { leaseBlockDays: 1 }).prisma, "kofi", now)).toBeNull();
  });
});

describe("rappels du leasing", () => {
  it("retard : un rappel par jour au livreur, l'équipe prévenue une fois à 3 jours", async () => {
    const { prisma, notifier, pushes, contracts } = setup([lease({})], drivers);
    await remindLeases(prisma, notifier, at("2026-11-24T08:10:00Z")); // 4 jours passés non payés
    expect(pushes).toEqual([
      { to: "staff", title: "Leasing en retard" },
      { to: "kofi", title: "Leasing en retard" },
    ]);
    await remindLeases(prisma, notifier, at("2026-11-24T09:10:00Z"));
    expect(pushes).toHaveLength(2);
    await remindLeases(prisma, notifier, at("2026-11-25T08:10:00Z"));
    expect(pushes).toHaveLength(3);
    // À jour : l'alerte de l'équipe est remise à zéro.
    contracts[0].payments.push(paid(6000));
    await remindLeases(prisma, notifier, at("2026-11-25T09:10:00Z"));
    expect(contracts[0].staffAlertedAt).toBeNull();
  });

  it("dernier jour payé : rappel pour payer le lendemain ; rien la nuit ni quand c'est payé d'avance", async () => {
    const { prisma, notifier, pushes } = setup([lease({ payments: [paid(3000)] }), lease({ id: "c2", driverId: "efi", payments: [paid(10_000)] })], drivers);
    await remindLeases(prisma, notifier, at("2026-11-22T05:00:00Z"));
    expect(pushes).toEqual([]);
    await remindLeases(prisma, notifier, at("2026-11-22T08:10:00Z"));
    expect(pushes).toEqual([{ to: "kofi", title: "Leasing payé jusqu'à ce soir" }]);
  });
});
