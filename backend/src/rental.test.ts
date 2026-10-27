import { describe, expect, it } from "vitest";
import { canMoveTrip, tripCommission, tripPrice, tripStatusUpdate, unitPrice } from "./rental.js";

describe("prix d'une location", () => {
  it("prix unitaire × quantité × durée, moins remise, plus frais", () => {
    // 5 000 / h × 5 h = 25 000, remise 5 % = 1 250, frais 1 000
    const p = tripPrice([{ name: "Berline", unitPrice: 5000, quantity: 1, discountPercent: 5 }], 5, { extraFee: 1000 });
    expect(p).toMatchObject({ fare: 25000, discount: 1250, extraFee: 1000, tax: 0, total: 24750 });
    expect(p.lines[0]).toMatchObject({ price: 25000, discount: 1250, duration: 5 });
  });

  it("plusieurs véhicules, remise manuelle et taxe", () => {
    const p = tripPrice(
      [
        { name: "SUV", unitPrice: 40000, quantity: 2, discountPercent: 0 },
        { name: "Minibus", unitPrice: 60000, quantity: 1, discountPercent: 10 },
      ],
      2,
      { extraDiscount: 4000, taxPercent: 18 },
    );
    // fare 160 000 + 120 000 = 280 000 ; remise 12 000 + 4 000 = 16 000 ; taxe 18 % de 264 000 = 47 520
    expect(p).toMatchObject({ fare: 280000, discount: 16000, tax: 47520, total: 311520 });
    expect(tripCommission(p, 10)).toBe(26400);
  });

  it("la remise ne dépasse jamais le prix", () => {
    expect(tripPrice([{ name: "x", unitPrice: 100, quantity: 1, discountPercent: 0 }], 1, { extraDiscount: 500 }).total).toBe(0);
  });

  it("choisit le prix selon le tarif", () => {
    const v = { hourlyPrice: 5000, dailyPrice: null, perKmPrice: 300, discountPercent: 0 };
    expect(unitPrice(v, "HOURLY")).toBe(5000);
    expect(unitPrice(v, "DAILY")).toBeNull();
    expect(unitPrice(v, "DISTANCE")).toBe(300);
  });
});

describe("statuts d'une course", () => {
  it("suit en attente → confirmée → en cours → terminée", () => {
    expect(canMoveTrip("PENDING", "CONFIRMED")).toBe(true);
    expect(canMoveTrip("CONFIRMED", "ONGOING")).toBe(true);
    expect(canMoveTrip("ONGOING", "COMPLETED")).toBe(true);
    expect(canMoveTrip("PENDING", "COMPLETED")).toBe(false);
    expect(canMoveTrip("COMPLETED", "CANCELLED")).toBe(false);
  });

  it("une course terminée est payée, une annulation garde son motif", () => {
    expect(tripStatusUpdate({ status: "ONGOING" }, "COMPLETED")).toMatchObject({ status: "COMPLETED", paymentStatus: "PAID" });
    expect(tripStatusUpdate({ status: "PENDING" }, "CANCELLED", "client absent")).toMatchObject({ cancellationReason: "client absent" });
  });
});
