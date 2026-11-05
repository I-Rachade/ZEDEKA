import { describe, expect, it } from "vitest";
import { normalizeCode, promoDiscount, promoLabel, type PromoRule } from "./promo.js";

const base: PromoRule = { code: "ZED20", kind: "PERCENT", value: 20, maxDiscount: 2000, minSubtotal: 3000, restaurantId: null, startsAt: null, endsAt: null, maxUses: null, perCustomer: 1, active: true };
const order = { subtotal: 7000, deliveryFee: 500, restaurantId: "r1", uses: 0, customerUses: 0 };

describe("codes promo", () => {
  it("pourcentage plafonné, comme ZED20 sur la planche (7 000 F : -1 400 F)", () => {
    expect(promoDiscount(base, order)).toEqual({ discount: 1400 });
    expect(promoDiscount(base, { ...order, subtotal: 20_000 })).toEqual({ discount: 2000 });
  });
  it("montant fixe et livraison offerte", () => {
    expect(promoDiscount({ ...base, kind: "AMOUNT", value: 1000, maxDiscount: null }, order)).toEqual({ discount: 1000 });
    expect(promoDiscount({ ...base, kind: "FREE_DELIVERY" }, order)).toEqual({ discount: 500 });
    expect(promoDiscount({ ...base, kind: "FREE_DELIVERY" }, { ...order, deliveryFee: 0 })).toEqual({ error: "La livraison est déjà offerte" });
  });
  it("refuse hors conditions : minimum, autre restaurant, expiré, épuisé, déjà utilisé", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(promoDiscount(base, { ...order, subtotal: 2000 }, now)).toHaveProperty("error");
    expect(promoDiscount({ ...base, restaurantId: "r2" }, order, now)).toEqual({ error: "Ce code ne vaut pas pour ce restaurant" });
    expect(promoDiscount({ ...base, endsAt: new Date("2026-11-01") }, order, now)).toEqual({ error: "Ce code a expiré" });
    expect(promoDiscount({ ...base, maxUses: 5 }, { ...order, uses: 5 }, now)).toHaveProperty("error");
    expect(promoDiscount(base, { ...order, customerUses: 1 }, now)).toEqual({ error: "Vous avez déjà utilisé ce code" });
    expect(promoDiscount({ ...base, active: false }, order, now)).toEqual({ error: "Ce code n'est pas actif" });
  });
  it("le code se tape sans souci de casse ni d'espaces", () => {
    expect(normalizeCode(" zed 20 ")).toBe("ZED20");
  });
  it("libellé court", () => {
    expect(promoLabel(base)).toMatch(/^-20 %, plafond 2\s000 FCFA, dès 3\s000 FCFA$/);
    expect(promoLabel({ kind: "FREE_DELIVERY", value: 0, maxDiscount: null, minSubtotal: 0 })).toBe("Livraison offerte");
  });
});
