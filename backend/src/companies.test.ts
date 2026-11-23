import express from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { billingError, monthOf, monthRange } from "./companies.js";
import { cashDue } from "./driver.js";
import { groupOrderPublicRouter, mergeLines } from "./routes/companyRoutes.js";

describe("comptes entreprise", () => {
  it("mois : bornes en UTC, décembre passe à janvier", () => {
    expect(monthRange("2026-11")).toEqual({ from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") });
    expect(monthRange("2026-12").to).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(monthOf(new Date("2026-11-30T23:59:00Z"))).toBe("2026-11");
  });

  it("commande facturée à l'entreprise : rien à encaisser", () => {
    expect(cashDue({ paymentMethod: "CASH", paymentStatus: "UNPAID", total: 5000, companyId: "co1" })).toBe(0);
    expect(cashDue({ paymentMethod: "CASH", paymentStatus: "UNPAID", total: 5000, companyId: null })).toBe(5000);
  });

  function db(limit: number, spent: number) {
    return {
      companyMember: {
        findMany: async ({ where }: { where: { phone: string } }) =>
          where.phone === "+22890112233" ? [{ company: { id: "co1", name: "Ecobank", kind: "OFFICE", monthlyLimit: limit } }] : [],
      },
      order: { aggregate: async () => ({ _sum: { total: spent } }) },
    } as unknown as PrismaClient;
  }

  it("facturation : membre requis, plafond du mois respecté", async () => {
    expect(await billingError(db(0, 0), "co1", null, 1000)).toBe("Connectez-vous pour facturer à votre entreprise");
    expect(await billingError(db(0, 0), "co1", "+22899999999", 1000)).toBe("Votre numéro n'est pas inscrit dans ce compte entreprise");
    expect(await billingError(db(0, 900_000), "co1", "+22890112233", 50_000)).toBeNull();
    expect(await billingError(db(100_000, 90_000), "co1", "+22890112233", 5_000)).toBeNull();
    expect(await billingError(db(100_000, 90_000), "co1", "+22890112233", 15_000)).toMatch(/^Plafond mensuel de l'entreprise atteint/);
  });
});

describe("commandes groupées", () => {
  const menu = [
    { id: "m1", name: "Riz sauce", price: 1500, variants: [], addons: [], options: [], stock: null },
    { id: "m2", name: "Attiéké poisson", price: 2000, variants: [], addons: [], options: [], stock: null },
  ];

  function fake(status = "OPEN") {
    const lines: Record<string, unknown>[] = [];
    const prisma = {
      groupOrder: {
        findUnique: async ({ where }: { where: { code: string } }) =>
          where.code === "ZG-ABCD-EFGH" ? { id: "g1", code: "ZG-ABCD-EFGH", restaurantId: "r1", status, deadline: null, _count: { lines: lines.length } } : null,
      },
      menuItem: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => menu.filter((m) => where.id.in.includes(m.id)) },
      groupOrderLine: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `l${lines.length + 1}`, ...data };
          lines.push(row);
          return row;
        },
        deleteMany: async ({ where }: { where: { id: string; editKeyHash: string } }) => {
          const i = lines.findIndex((l) => l.id === where.id && l.editKeyHash === where.editKeyHash);
          if (i < 0) return { count: 0 };
          lines.splice(i, 1);
          return { count: 1 };
        },
      },
    } as unknown as PrismaClient;
    const app = express();
    app.use(express.json());
    app.use(groupOrderPublicRouter(prisma));
    return { app, lines, prisma };
  }

  it("chacun ajoute sa part, prix recalculés par le serveur, retrait avec sa clé seulement", async () => {
    const { app, lines } = fake();
    const r = await request(app)
      .post("/group-orders/zg-abcd-efgh/lines")
      .send({ participant: "Afi", items: [{ menuItemId: "m1", quantity: 2 }] })
      .expect(201);
    expect(r.body.subtotal).toBe(3000);
    expect(lines).toHaveLength(1);
    await request(app).delete(`/group-orders/ZG-ABCD-EFGH/lines/${r.body.id}`).set("x-edit-key", "A".repeat(22)).expect(403);
    await request(app).delete(`/group-orders/ZG-ABCD-EFGH/lines/${r.body.id}`).set("x-edit-key", r.body.editKey).expect(200);
    expect(lines).toHaveLength(0);
  });

  it("plat inconnu ou commande fermée : refusé", async () => {
    await request(fake().app).post("/group-orders/ZG-ABCD-EFGH/lines").send({ participant: "Afi", items: [{ menuItemId: "zz", quantity: 1 }] }).expect(400);
    await request(fake("SUBMITTED").app).post("/group-orders/ZG-ABCD-EFGH/lines").send({ participant: "Afi", items: [{ menuItemId: "m1", quantity: 1 }] }).expect(409);
  });

  it("envoi : panier fusionné et récapitulatif « qui a pris quoi »", async () => {
    const { prisma } = fake();
    const merged = await mergeLines(prisma, "r1", [
      { id: "a", participant: "Afi", items: JSON.stringify([{ menuItemId: "m1", quantity: 2 }]), subtotal: 3000 },
      { id: "b", participant: "Koffi", items: JSON.stringify([{ menuItemId: "m2", quantity: 1 }, { menuItemId: "m1", quantity: 1 }]), subtotal: 3500 },
    ]);
    expect(merged.items).toHaveLength(3);
    expect(merged.who).toEqual(["Afi : 2 × Riz sauce", "Koffi : 1 × Attiéké poisson, 1 × Riz sauce"]);
  });
});
