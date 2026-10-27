import { describe, expect, it } from "vitest";
import { canDriverMove, cashDue, checkCash, earningsSummary, eventTime } from "./driver.js";

describe("canDriverMove", () => {
  it("récupère un repas accepté, un colis dès la demande, puis livre", () => {
    expect(canDriverMove("FOOD", "READY", "PICKED_UP")).toBe(true);
    expect(canDriverMove("FOOD", "PENDING", "PICKED_UP")).toBe(false);
    expect(canDriverMove("PARCEL", "PENDING", "PICKED_UP")).toBe(true);
    expect(canDriverMove("FOOD", "READY", "DELIVERED")).toBe(false);
    expect(canDriverMove("FOOD", "PICKED_UP", "DELIVERED")).toBe(true);
    expect(canDriverMove("FOOD", "PICKED_UP", "CANCELLED")).toBe(false);
  });
});

describe("eventTime", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("garde l'heure de l'appareil si elle est plausible", () => {
    expect(eventTime("2026-10-27T11:40:00Z", now).toISOString()).toBe("2026-10-27T11:40:00.000Z");
    expect(eventTime("2026-10-27T12:01:00Z", now)).toEqual(now);
    expect(eventTime("2026-10-25T12:00:00Z", now)).toEqual(now);
    expect(eventTime("n'importe quoi", now)).toEqual(now);
    expect(eventTime(undefined, now)).toEqual(now);
  });
});

describe("espèces", () => {
  it("ne demande les espèces que pour un paiement à la livraison", () => {
    expect(cashDue({ paymentMethod: "CASH", paymentStatus: "UNPAID", total: 3500 })).toBe(3500);
    expect(cashDue({ paymentMethod: "MOBILE_MONEY", paymentStatus: "PAID", total: 3500 })).toBe(0);
  });
  it("exige un motif en cas d'écart", () => {
    expect(checkCash(3500, 3500, undefined)).toBeNull();
    expect(checkCash(3500, undefined, undefined)).toMatch(/montant reçu/);
    expect(checkCash(3500, 3000, " ")).toMatch(/pourquoi/);
    expect(checkCash(3500, 3000, "Client n'avait pas la monnaie")).toBeNull();
    expect(checkCash(0, undefined, undefined)).toBeNull();
  });
});

describe("earningsSummary", () => {
  it("additionne par jour, semaine et mois", () => {
    const now = new Date("2026-10-27T18:00:00Z");
    const s = earningsSummary(
      [
        { deliveredAt: new Date("2026-10-27T09:00:00Z"), driverEarning: 500 },
        { deliveredAt: new Date("2026-10-27T10:00:00Z"), driverEarning: 700 },
        { deliveredAt: new Date("2026-10-22T10:00:00Z"), driverEarning: 300 },
        { deliveredAt: new Date("2026-10-02T10:00:00Z"), driverEarning: 1000 },
        { deliveredAt: new Date("2026-09-30T10:00:00Z"), driverEarning: 900 },
      ],
      now,
    );
    expect([s.today, s.todayCount, s.week, s.month]).toEqual([1200, 2, 1500, 2500]);
    expect(s.days[0]).toEqual({ date: "2026-10-27", amount: 1200, count: 2 });
  });
});
