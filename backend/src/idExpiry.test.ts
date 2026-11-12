import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { checkIdDates, idStatus, noticeDue, notifyExpiringIds } from "./idExpiry.js";
import type { Notifier } from "./notify.js";

const now = new Date("2026-11-12T12:00:00Z");
const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("dates de la pièce d'identité", () => {
  it("accepte une pièce délivrée avant aujourd'hui et encore valable", () => {
    expect(checkIdDates({ issuedAt: "2022-03-01", expiresAt: "2032-03-01" }, now)).toEqual({ issuedAt: day("2022-03-01"), expiresAt: day("2032-03-01") });
    // Valable jusqu'au jour d'expiration compris.
    expect(checkIdDates({ issuedAt: "2016-11-12", expiresAt: "2026-11-12" }, now).expiresAt).toEqual(day("2026-11-12"));
  });

  it("refuse une délivrance future, une expiration avant la délivrance ou une pièce expirée", () => {
    expect(() => checkIdDates({ issuedAt: "2026-12-01", expiresAt: "2036-12-01" }, now)).toThrow(/futur/);
    expect(() => checkIdDates({ issuedAt: "2022-03-01", expiresAt: "2021-03-01" }, now)).toThrow(/après la date de délivrance/);
    expect(() => checkIdDates({ issuedAt: "2016-01-01", expiresAt: "2026-11-11" }, now)).toThrow(/expirée/);
  });

  it("état : valable, bientôt expirée (30 jours), expirée, sans dates", () => {
    expect(idStatus(day("2030-01-01"), now)).toBe("VALID");
    expect(idStatus(day("2026-12-01"), now)).toBe("SOON");
    expect(idStatus(day("2026-11-12"), now)).toBe("SOON");
    expect(idStatus(day("2026-11-11"), now)).toBe("EXPIRED");
    expect(idStatus(null, now)).toBe("NO_DATES");
  });

  it("un rappel à 30 jours, à 7 jours, puis à l'expiration, chacun une seule fois", () => {
    expect(noticeDue(day("2027-06-01"), null, now)).toBeNull();
    expect(noticeDue(day("2026-12-01"), null, now)).toBe("30");
    expect(noticeDue(day("2026-12-01"), "30", now)).toBeNull();
    expect(noticeDue(day("2026-11-15"), "30", now)).toBe("7");
    // Passé à côté du rappel à 30 jours : directement celui à 7 jours.
    expect(noticeDue(day("2026-11-15"), null, now)).toBe("7");
    expect(noticeDue(day("2026-11-10"), "7", now)).toBe("EXPIRED");
    expect(noticeDue(day("2026-11-10"), "EXPIRED", now)).toBeNull();
  });
});

describe("tâche des rappels", () => {
  it("prévient le livreur et l'équipe (qui dépose la nouvelle pièce) ; pas deux fois", async () => {
    const docs = [
      { id: "a", driverId: "kofi", expiresAt: day("2026-12-01"), expiryNotice: null as string | null, driver: { name: "Kofi" } },
      { id: "b", driverId: "ama", expiresAt: day("2026-11-01"), expiryNotice: "7" as string | null, driver: { name: "Ama" } },
    ];
    const pushes: string[] = [];
    const staff: string[] = [];
    const prisma = {
      zedDocument: {
        findMany: async () => docs.filter((d) => d.expiryNotice !== "EXPIRED").map((d) => ({ ...d })),
        updateMany: async ({ where, data }: { where: { id: string; expiryNotice: string | null }; data: { expiryNotice: string } }) => {
          const d = docs.find((x) => x.id === where.id && x.expiryNotice === where.expiryNotice);
          if (d) d.expiryNotice = data.expiryNotice;
          return { count: d ? 1 : 0 };
        },
      },
    } as unknown as PrismaClient;
    const notifier = {
      push: async (_role: string, subject: string, p: { title: string }) => void pushes.push(`${subject}:${p.title}`),
      staff: async (_c: string, p: { body: string }) => void staff.push(p.body),
    } as unknown as Notifier;
    expect(await notifyExpiringIds(prisma, notifier, now)).toBe(2);
    expect(pushes).toEqual(["kofi:Pièce d'identité bientôt expirée", "ama:Pièce d'identité expirée"]);
    expect(staff).toEqual(["Kofi : pièce d'identité qui expire le 1 décembre 2026.", "Ama : pièce d'identité expirée le 1 novembre 2026."]);
    expect(await notifyExpiringIds(prisma, notifier, now)).toBe(0);
  });
});
