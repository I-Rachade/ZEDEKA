import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { chargeStorage, chargesToWithhold, isLowStock, mergeLines, parseStockLines, previousPeriod, reserveStock, warehouseOf } from "./logistics.js";
import { dayBounds, daySummary, saleTotals, takeFromShop } from "./pos.js";

// Base en mémoire minimale : articles de stock et frais logistiques.
function fakeDb(items: { id: string; merchantId: string; name: string; quantity: number; shopQuantity?: number; price?: number | null; archivedAt?: Date | null }[]) {
  const rows = items.map((i) => ({ shopQuantity: 0, price: null, archivedAt: null, ...i }));
  const charges: { merchantId: string; kind: string; period: string | null; amount: number }[] = [];
  const match = (r: (typeof rows)[number], w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      const val = (r as Record<string, unknown>)[k];
      if (v && typeof v === "object" && "in" in v) return (v.in as unknown[]).includes(val);
      if (v && typeof v === "object" && "gte" in v) return (val as number) >= (v.gte as number);
      if (v && typeof v === "object" && "gt" in v) return (val as number) > (v.gt as number);
      return val === v;
    });
  const apply = (r: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "decrement" in v) r[k] = (r[k] as number) - (v.decrement as number);
      else if (v && typeof v === "object" && "increment" in v) r[k] = (r[k] as number) + (v.increment as number);
      else r[k] = v;
    }
  };
  const prisma = {
    settings: { findFirst: async () => ({ storageFeePerItem: 25, returnFee: 500 }) },
    stockItem: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => apply(r, data));
        return { count: hit.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        apply(r, data);
        return r;
      },
    },
    logisticsCharge: {
      findFirst: async ({ where }: { where: { merchantId: string; kind: string; period: string } }) => charges.find((c) => c.merchantId === where.merchantId && c.kind === where.kind && c.period === where.period) ?? null,
      create: async ({ data }: { data: (typeof charges)[number] }) => (charges.push(data), data),
    },
  } as unknown as PrismaClient;
  return { prisma, rows, charges };
}

describe("logistique des e-commerçants", () => {
  it("lit les lignes de stock d'un colis et ignore le reste", () => {
    expect(parseStockLines(null)).toEqual([]);
    expect(parseStockLines("oops")).toEqual([]);
    expect(parseStockLines(JSON.stringify([{ stockItemId: "a", name: "Robe", quantity: 2 }, { stockItemId: "b", quantity: 0 }]))).toEqual([{ stockItemId: "a", name: "Robe", quantity: 2 }]);
  });

  it("regroupe les lignes d'un même article", () => {
    expect(mergeLines([{ stockItemId: "a", quantity: 1 }, { stockItemId: "b", quantity: 2 }, { stockItemId: "a", quantity: 3 }])).toEqual([
      { stockItemId: "a", quantity: 4 },
      { stockItemId: "b", quantity: 2 },
    ]);
  });

  it("entrepôt ouvert seulement avec une adresse", () => {
    expect(warehouseOf({ warehouseAddress: "  ", warehouseLatitude: null, warehouseLongitude: null })).toBeNull();
    expect(warehouseOf({ warehouseAddress: "Agoè", warehouseLatitude: 6.2, warehouseLongitude: 1.2 })).toEqual({ address: "Agoè", latitude: 6.2, longitude: 1.2 });
  });

  it("mois précédent, y compris en janvier", () => {
    expect(previousPeriod(new Date("2026-12-01T05:00:00Z"))).toBe("2026-11");
    expect(previousPeriod(new Date("2027-01-01T00:20:00Z"))).toBe("2026-12");
  });

  it("sort le stock d'un colis, et refuse sans rien décompter si un article manque", async () => {
    const { prisma, rows } = fakeDb([
      { id: "a", merchantId: "m1", name: "Robe", quantity: 5 },
      { id: "b", merchantId: "m1", name: "Sac", quantity: 1 },
      { id: "c", merchantId: "m2", name: "Montre", quantity: 9 },
    ]);
    expect(await reserveStock(prisma, "m1", [{ stockItemId: "a", quantity: 2 }])).toEqual([{ stockItemId: "a", name: "Robe", quantity: 2 }]);
    expect(rows[0].quantity).toBe(3);
    await expect(reserveStock(prisma, "m1", [{ stockItemId: "a", quantity: 1 }, { stockItemId: "b", quantity: 2 }])).rejects.toThrow("Stock insuffisant : Sac (1 en stock)");
    expect(rows[0].quantity).toBe(3); // la robe décomptée est remise
    // L'article d'un autre marchand n'est pas accessible.
    await expect(reserveStock(prisma, "m1", [{ stockItemId: "c", quantity: 1 }])).rejects.toThrow("Article introuvable");
    expect(rows[2].quantity).toBe(9);
  });

  it("frais de stockage le 1er du mois, une seule fois par marchand", async () => {
    const { prisma, charges } = fakeDb([
      { id: "a", merchantId: "m1", name: "Robe", quantity: 4 },
      { id: "b", merchantId: "m1", name: "Sac", quantity: 6 },
      { id: "c", merchantId: "m2", name: "Montre", quantity: 0 },
    ]);
    expect(await chargeStorage(prisma, new Date("2026-12-02T00:20:00Z"))).toBe(0);
    expect(await chargeStorage(prisma, new Date("2026-12-01T00:20:00Z"))).toBe(1);
    expect(await chargeStorage(prisma, new Date("2026-12-01T01:20:00Z"))).toBe(0);
    expect(charges).toEqual([expect.objectContaining({ merchantId: "m1", kind: "STORAGE", period: "2026-11", amount: 250 })]);
  });

  it("frais retenus sur un reversement : les plus anciens, sans dépasser le montant", () => {
    const c = [
      { id: "1", amount: 500 },
      { id: "2", amount: 250 },
      { id: "3", amount: 400 },
    ];
    expect(chargesToWithhold(c, 1000).map((x) => x.id)).toEqual(["1", "2"]);
    expect(chargesToWithhold(c, 300)).toEqual([]);
    expect(chargesToWithhold(c, -50)).toEqual([]);
  });

  it("alerte de stock bas sur le stock total", () => {
    expect(isLowStock({ quantity: 2, shopQuantity: 1, alertAt: 3 })).toBe(true);
    expect(isLowStock({ quantity: 2, shopQuantity: 2, alertAt: 3 })).toBe(false);
    expect(isLowStock({ quantity: 0, shopQuantity: 0, alertAt: null })).toBe(false);
  });
});

describe("caisse des marchands", () => {
  it("calcule le total, la remise et la monnaie", () => {
    const lines = [
      { price: 1500, quantity: 2 },
      { price: 500, quantity: 1 },
    ];
    expect(saleTotals(lines, 0, "CASH", 5000)).toEqual({ subtotal: 3500, total: 3500, change: 1500 });
    expect(saleTotals(lines, 500, "FLOOZ")).toEqual({ subtotal: 3500, total: 3000, change: 0 });
    expect(() => saleTotals(lines, 4000, "CASH")).toThrow("La remise dépasse");
    expect(() => saleTotals(lines, 0, "CASH", 3000)).toThrow("Espèces reçues insuffisantes");
  });

  it("vend le stock boutique avec le prix de la fiche, jamais au-delà du stock", async () => {
    const { prisma, rows } = fakeDb([
      { id: "a", merchantId: "m1", name: "Robe", quantity: 10, shopQuantity: 3, price: 7000 },
      { id: "b", merchantId: "m1", name: "Sac", quantity: 0, shopQuantity: 5, price: null },
    ]);
    expect(await takeFromShop(prisma, "m1", [{ stockItemId: "a", quantity: 2 }])).toEqual([{ stockItemId: "a", name: "Robe", quantity: 2, price: 7000 }]);
    expect(rows[0]).toMatchObject({ shopQuantity: 1, quantity: 10 });
    await expect(takeFromShop(prisma, "m1", [{ stockItemId: "a", quantity: 2 }])).rejects.toThrow("Stock insuffisant en boutique : Robe (1)");
    await expect(takeFromShop(prisma, "m1", [{ stockItemId: "a", quantity: 1 }, { stockItemId: "b", quantity: 1 }])).rejects.toThrow("Indiquez d'abord le prix de vente : Sac");
    expect(rows[0].shopQuantity).toBe(1);
  });

  it("journée de caisse et totaux par moyen de paiement", () => {
    const now = new Date("2026-11-23T15:00:00Z");
    expect(dayBounds(undefined, now).key).toBe("2026-11-23");
    expect(dayBounds("2026-11-20", now).start.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(dayBounds("20-11-2026", now).key).toBe("2026-11-23");
    const s = daySummary([
      { total: 3000, method: "CASH", cancelledAt: null },
      { total: 2000, method: "FLOOZ", cancelledAt: null },
      { total: 900, method: "CASH", cancelledAt: now },
    ]);
    expect(s).toEqual({ count: 2, total: 5000, byMethod: { CASH: 3000, FLOOZ: 2000, TMONEY: 0 }, cancelled: 1 });
  });
});
