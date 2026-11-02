import { describe, expect, it } from "vitest";
import { cancellationFee, deliveryFee, distanceKm, driverEarning, foodDeliveryFee, foodDistanceKm, foodFee, parcelDeliveryFee, parcelExtraFee, PARCEL_ZONE_ID } from "./delivery.js";
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

describe("livraison d'un repas", () => {
  const t = { foodMinFee: 500, foodPerKmFee: 200, foodMaxFee: 2500 };
  it("se calcule au km quand la distance est connue", () => {
    expect(foodFee(t, 1.2)).toBe(500);
    expect(foodFee(t, 4.1)).toBe(850);
    expect(foodFee(t, 30)).toBe(2500);
    expect(foodFee({ ...t, foodMaxFee: 0 }, 30)).toBe(6000);
  });
  it("applique le minimum au km sans distance (plus de prix de zone)", () => {
    expect(foodFee(t, null)).toBe(500);
  });
});

describe("distance d'un repas", () => {
  const resto = { latitude: 6.1319, longitude: 1.2386 };
  const centre = { latitude: 6.15, longitude: 1.2 };
  it("entre le restaurant et le client", () => {
    expect(foodDistanceKm({ point: { latitude: 6.1475, longitude: 1.2125 } }, { point: resto })).toBe(3.4);
  });
  it("prend le centre de la zone du client si sa position est inconnue", () => {
    expect(foodDistanceKm({ point: null, zone: centre }, { point: resto })).toBe(4.7);
  });
  it("prend le centre de la zone du restaurant s'il n'a pas de position", () => {
    expect(foodDistanceKm({ point: resto }, { point: { latitude: null, longitude: null }, zone: centre })).toBe(4.7);
  });
  it("reste inconnue sans position ni centre", () => {
    expect(foodDistanceKm({ point: null, zone: { latitude: null, longitude: null } }, { point: resto })).toBeNull();
  });
});

describe("livraison au km ou par zone (réglages)", () => {
  const food = { foodMinFee: 500, foodPerKmFee: 200, foodMaxFee: 0 };
  const parcel = { parcelMinFee: 1000, parcelPerKmFee: 200, parcelMaxFee: 0 };
  const zone = { id: "z-be", deliveryFee: 1200 };
  it("au km par défaut, le prix de la zone est ignoré", () => {
    expect(foodDeliveryFee(food, 4.1, zone)).toBe(850);
    expect(parcelDeliveryFee(parcel, 4.1, zone)).toBe(1000);
  });
  it("par zone : prix fixe de la zone de livraison, quelle que soit la distance", () => {
    expect(foodDeliveryFee({ ...food, foodPricingMode: "ZONE" }, 4.1, zone)).toBe(1200);
    expect(foodDeliveryFee({ ...food, foodPricingMode: "ZONE" }, null, zone)).toBe(1200);
    expect(parcelDeliveryFee({ ...parcel, parcelPricingMode: "ZONE" }, 12, zone)).toBe(1200);
  });
  it("par zone sans zone connue : repli au km", () => {
    expect(foodDeliveryFee({ ...food, foodPricingMode: "ZONE" }, 4.1, null)).toBe(850);
    expect(parcelDeliveryFee({ ...parcel, parcelPricingMode: "ZONE" }, null, { id: PARCEL_ZONE_ID, deliveryFee: 0 })).toBe(1000);
  });
});
