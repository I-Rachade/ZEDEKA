import { describe, expect, it } from "vitest";
import { cancellationFee, deliveryFee, distanceKm, driverEarning, parcelExtraFee } from "./delivery.js";
import { priceOrder } from "./pricing.js";
import { settlementTotals } from "./routes/adminFinance.js";

describe("tarifs de livraison", () => {
  const distanceZone = { pricing: "DISTANCE" as const, deliveryFee: 1000, minFee: 800, perKmFee: 250, maxFee: 2500 };

  it("applique le tarif fixe, ou le tarif par défaut sans distance", () => {
    expect(deliveryFee({ ...distanceZone, pricing: "FIXED" }, 3)).toBe(1000);
    expect(deliveryFee(distanceZone, null)).toBe(1000);
  });

  it("calcule au km avec minimum, maximum et arrondi à 50", () => {
    expect(deliveryFee(distanceZone, 1)).toBe(800);
    expect(deliveryFee(distanceZone, 4.1)).toBe(1050);
    expect(deliveryFee(distanceZone, 30)).toBe(2500);
  });

  it("mesure une distance plausible dans Lomé", () => {
    const km = distanceKm({ latitude: 6.1475, longitude: 1.2125 }, { latitude: 6.1319, longitude: 1.2386 });
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(4);
  });

  it("ajoute le supplément de colis", () => {
    expect(parcelExtraFee({ surcharge: 500, perKgFee: 100 }, 3.2)).toBe(850);
  });
});

describe("annulation et part du livreur", () => {
  const rules = { freeCancellationMinutes: 5, cancellationFeePercent: 50 };
  const created = new Date("2026-10-27T10:00:00Z");

  it("est gratuite au début, payante ensuite ou après retrait", () => {
    const o = { createdAt: created, status: "PENDING", deliveryFee: 1000, extraFee: 0 };
    expect(cancellationFee(o, rules, new Date("2026-10-27T10:03:00Z"))).toBe(0);
    expect(cancellationFee(o, rules, new Date("2026-10-27T10:10:00Z"))).toBe(500);
    expect(cancellationFee({ ...o, status: "PICKED_UP" }, rules, new Date("2026-10-27T10:01:00Z"))).toBe(500);
  });

  it("applique le taux selon le type de course", () => {
    const s = { foodDriverCommission: 0, parcelDriverCommission: 60 };
    expect(driverEarning({ type: "FOOD", deliveryFee: 1000, extraFee: 0 }, s)).toBe(0);
    expect(driverEarning({ type: "PARCEL", deliveryFee: 1000, extraFee: 500 }, s)).toBe(900);
  });
});

describe("variantes et suppléments", () => {
  const items = [
    {
      id: "riz",
      name: "Riz",
      price: 2500,
      variants: [
        { id: "n", name: "Normale", price: 2500 },
        { id: "g", name: "Grande", price: 3500 },
      ],
      addons: [{ id: "oeuf", name: "Œuf", price: 200 }],
    },
  ];

  it("exige une variante et additionne les suppléments", () => {
    expect(() => priceOrder([{ menuItemId: "riz", quantity: 1 }], items, 0)).toThrow(/variante/);
    const r = priceOrder(
      [
        { menuItemId: "riz", quantity: 1, variantId: "g", addonIds: ["oeuf"] },
        { menuItemId: "riz", quantity: 1, variantId: "g", addonIds: ["oeuf"] },
        { menuItemId: "riz", quantity: 1, variantId: "n" },
      ],
      items,
      1000,
    );
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ variantName: "Grande", unitPrice: 3700, quantity: 2 });
    expect(r.subtotal).toBe(9900);
  });

  it("refuse un supplément d'un autre plat", () => {
    expect(() => priceOrder([{ menuItemId: "riz", quantity: 1, variantId: "n", addonIds: ["x"] }], items, 0)).toThrow();
  });
});

describe("reversement restaurant", () => {
  it("déduit la commission des plats vendus", () => {
    expect(settlementTotals([{ subtotal: 5000, commission: 500 }, { subtotal: 3000, commission: 300 }])).toEqual({
      orderCount: 2,
      orderTotal: 8000,
      commission: 800,
      amountDue: 7200,
    });
  });
});
