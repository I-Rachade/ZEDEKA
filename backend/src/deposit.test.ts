import type { Order, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { balanceOf, depositCost, settlesOnDeposit } from "./deposit.js";
import { statusUpdate } from "./orderFlow.js";

const food = { type: "FOOD", restaurantId: "r1", fulfillment: "DELIVERY", paymentMethod: "CASH" } as const;

describe("dépôt de Zedeka chez les restaurants", () => {
  it("règle sur le dépôt les repas payés à Zedeka, pas les retraits payés au comptoir", () => {
    expect(settlesOnDeposit(food, true)).toBe(true);
    expect(settlesOnDeposit({ ...food, paymentMethod: "MOBILE_MONEY" }, true)).toBe(true);
    expect(settlesOnDeposit({ ...food, fulfillment: "PICKUP", paymentMethod: "MOBILE_MONEY" }, true)).toBe(true);
    expect(settlesOnDeposit({ ...food, fulfillment: "PICKUP" }, true)).toBe(false);
    expect(settlesOnDeposit(food, false)).toBe(false);
    expect(settlesOnDeposit({ ...food, type: "PARCEL", restaurantId: null }, true)).toBe(false);
  });

  it("solde = dépôts − plats des commandes réglées dessus", () => {
    // 25 000 déposés, deux repas livrés (5 000 et 3 500), une recharge de 8 500, une correction de −500.
    const b = balanceOf(
      [{ amount: 25000 }, { amount: 8500 }, { amount: -500 }],
      [
        { subtotal: 5000, commission: 0 },
        { subtotal: 3500, commission: 0 },
      ],
    );
    expect(b).toEqual({ active: true, deposited: 33000, consumed: 8500, balance: 24500 });
    expect(balanceOf([], []).active).toBe(false);
    expect(depositCost({ subtotal: 5000, commission: 250 })).toBe(4750);
  });

  it("marque la commande livrée comme réglée sur le dépôt quand le restaurant en a un", async () => {
    const prisma = (deposits: number) =>
      ({
        settings: { upsert: async () => ({ foodDriverCommission: 0, parcelDriverCommission: 0 }) },
        restaurantDeposit: { count: async () => deposits },
        driver: { findUnique: async () => null },
      }) as unknown as PrismaClient;
    const order = { ...food, status: "PICKED_UP", deliveryFee: 500, extraFee: 0, driverId: null } as unknown as Order;
    expect((await statusUpdate(prisma(1), order, "DELIVERED")).paidFromDeposit).toBe(true);
    expect((await statusUpdate(prisma(0), order, "DELIVERED")).paidFromDeposit).toBeUndefined();
    const counter = { ...order, status: "READY", fulfillment: "PICKUP" } as unknown as Order;
    expect((await statusUpdate(prisma(1), counter, "DELIVERED")).paidFromDeposit).toBeUndefined();
  });
});
