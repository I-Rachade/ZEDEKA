import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OutOfStock, takeStock } from "./stock.js";

function fakeDb(stock: Record<string, number>) {
  return {
    stock,
    menuItem: {
      updateMany: async ({ where, data }: { where: { id: string; stock: { gte: number } }; data: { stock: { decrement: number } } }) => {
        if ((stock[where.id] ?? -1) < where.stock.gte) return { count: 0 };
        stock[where.id] -= data.stock.decrement;
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: { stock: { increment: number } } }) => {
        stock[where.id] += data.stock.increment;
      },
    },
  };
}

describe("takeStock", () => {
  it("retire les quantités commandées et ignore les plats sans stock", async () => {
    const db = fakeDb({ a: 5 });
    await takeStock(db as unknown as PrismaClient, [{ menuItemId: "a", quantity: 2 }, { menuItemId: "a", quantity: 1 }, { menuItemId: "b", quantity: 9 }], [
      { id: "a", name: "Pagne", stock: 5 },
      { id: "b", name: "Riz", stock: null },
    ]);
    expect(db.stock.a).toBe(2);
  });

  it("refuse sans rien retirer quand un article manque, et rend ce qui a été pris", async () => {
    const db = fakeDb({ a: 5, b: 1 });
    await expect(
      takeStock(db as unknown as PrismaClient, [{ menuItemId: "a", quantity: 2 }, { menuItemId: "b", quantity: 2 }], [
        { id: "a", name: "Pagne", stock: 5 },
        { id: "b", name: "Sac", stock: 1 },
      ]),
    ).rejects.toBeInstanceOf(OutOfStock);
    expect(db.stock).toEqual({ a: 5, b: 1 });
  });

  it("rend le stock si la commande n'est pas créée", async () => {
    const db = fakeDb({ a: 3 });
    const restore = await takeStock(db as unknown as PrismaClient, [{ menuItemId: "a", quantity: 3 }], [{ id: "a", name: "Pagne", stock: 3 }]);
    expect(db.stock.a).toBe(0);
    await restore();
    expect(db.stock.a).toBe(3);
  });
});
