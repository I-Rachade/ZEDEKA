import type { Order, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { balanceOf, cashToRemit, depositCost, driverAdvance, paidByDriverOnSite, settlesOnDeposit } from "./deposit.js";
import { statusUpdate } from "./orderFlow.js";

const food = { type: "FOOD", restaurantId: "r1", fulfillment: "DELIVERY", paymentMethod: "CASH" } as const;

describe("dépôt de Zedeka chez les restaurants", () => {
  it("règle sur le dépôt les repas livrés par un salarié, pas ceux des indépendants ni les retraits payés au comptoir", () => {
    expect(settlesOnDeposit(food, true, true)).toBe(true);
    expect(settlesOnDeposit({ ...food, paymentMethod: "MOBILE_MONEY" }, true, true)).toBe(true);
    expect(settlesOnDeposit(food, true, false)).toBe(false);
    expect(settlesOnDeposit({ ...food, paymentMethod: "MOBILE_MONEY" }, true, false)).toBe(false);
    expect(settlesOnDeposit({ ...food, fulfillment: "PICKUP", paymentMethod: "MOBILE_MONEY" }, true, false)).toBe(true);
    expect(settlesOnDeposit({ ...food, fulfillment: "PICKUP" }, true, false)).toBe(false);
    expect(settlesOnDeposit(food, false, true)).toBe(false);
    expect(settlesOnDeposit({ ...food, type: "PARCEL", restaurantId: null }, true, true)).toBe(false);
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

  it("marque la commande livrée par un salarié comme réglée sur le dépôt quand le restaurant en a un", async () => {
    const prisma = (deposits: number, employment = "STAFF") =>
      ({
        settings: { findFirst: async () => ({ foodDriverCommission: 0, parcelDriverCommission: 0 }) },
        restaurantDeposit: { count: async () => deposits },
        driver: { findUnique: async () => ({ employment }) },
      }) as unknown as PrismaClient;
    const order = { ...food, status: "PICKED_UP", deliveryFee: 500, extraFee: 0, driverId: "d1" } as unknown as Order;
    expect((await statusUpdate(prisma(1), order, "DELIVERED")).paidFromDeposit).toBe(true);
    expect((await statusUpdate(prisma(0), order, "DELIVERED")).paidFromDeposit).toBeUndefined();
    // Livreur indépendant : il a payé les plats au restaurant sur place, le dépôt n'est pas débité.
    const freelance = await statusUpdate(prisma(1, "FREELANCE"), order, "DELIVERED");
    expect(freelance.paidFromDeposit).toBeUndefined();
    expect(freelance.paidByDriver).toBe(true);
    // Sans dépôt, rien ne change pour l'indépendant : relevé habituel.
    expect((await statusUpdate(prisma(0, "FREELANCE"), order, "DELIVERED")).paidByDriver).toBeUndefined();
    const counter = { ...order, status: "READY", fulfillment: "PICKUP" } as unknown as Order;
    expect((await statusUpdate(prisma(1), counter, "DELIVERED")).paidFromDeposit).toBeUndefined();
  });

  it("livreur indépendant chez un restaurant avec dépôt : il paie les plats sur place, avance retenue sur ses espèces", () => {
    expect(paidByDriverOnSite(food, true, "FREELANCE")).toBe(true);
    expect(paidByDriverOnSite(food, true, "STAFF")).toBe(false);
    expect(paidByDriverOnSite(food, false, "FREELANCE")).toBe(false);
    expect(paidByDriverOnSite({ ...food, fulfillment: "PICKUP" }, true, "FREELANCE")).toBe(false);
    expect(paidByDriverOnSite(food, true, null)).toBe(false);
    const o = { paymentMethod: "CASH", total: 6000, cashCollected: null, paidByDriver: true, subtotal: 5000, commission: 250 };
    expect(driverAdvance(o)).toBe(4750);
    expect(cashToRemit(o)).toBe(1250);
    // Payé en mobile money : Zedeka doit l'avance au livreur.
    expect(cashToRemit({ ...o, paymentMethod: "MOBILE_MONEY" })).toBe(-4750);
    expect(cashToRemit({ ...o, paidByDriver: false })).toBe(6000);
  });
});
