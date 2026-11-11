import { describe, expect, it } from "vitest";
import { shouldTellDriverReady } from "./routes/restaurantPanel.js";

describe("« Prête » prévient le livreur", () => {
  it("seulement pour une livraison avec un livreur affecté", () => {
    expect(shouldTellDriverReady({ driverId: "d1", fulfillment: "DELIVERY", tableNumber: null })).toBe(true);
    expect(shouldTellDriverReady({ driverId: null, fulfillment: "DELIVERY", tableNumber: null })).toBe(false);
    expect(shouldTellDriverReady({ driverId: "d1", fulfillment: "PICKUP", tableNumber: null })).toBe(false);
    expect(shouldTellDriverReady({ driverId: "d1", fulfillment: "DELIVERY", tableNumber: 4 })).toBe(false);
  });
});
