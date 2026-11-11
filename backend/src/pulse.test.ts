import { describe, expect, it } from "vitest";
import { pulseVersion } from "./routes/restaurantPanel.js";
import { restaurantRoleMay } from "./restaurantTeam.js";

const order = { id: "o1", status: "PENDING", paymentStatus: "UNPAID", driverId: null, total: 3500, restaurantMessageAt: null };

describe("pouls de l'espace restaurant", () => {
  it("garde la même version tant que rien ne change", () => {
    expect(pulseVersion([order])).toBe(pulseVersion([{ ...order }]));
  });
  it("change de version dès qu'une commande arrive, change d'étape, est payée, reçoit un livreur ou est modifiée", () => {
    const base = pulseVersion([order]);
    for (const changed of [
      [order, { ...order, id: "o2" }],
      [{ ...order, status: "PREPARING" }],
      [{ ...order, paymentStatus: "PAID" }],
      [{ ...order, driverId: "d1" }],
      [{ ...order, total: 3000 }],
      [{ ...order, restaurantMessageAt: new Date("2026-11-11T12:00:00Z") }],
      [],
    ]) {
      expect(pulseVersion(changed)).not.toBe(base);
    }
  });
  it("est ouvert à la caissière", () => {
    expect(restaurantRoleMay("CASHIER", "GET", "/pulse")).toBe(true);
  });
});
