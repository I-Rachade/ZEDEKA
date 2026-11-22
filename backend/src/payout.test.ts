import express from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { adminFinanceRouter } from "./routes/adminFinance.js";
import { payoutPhoneInput } from "./customer.js";

// Reversement d'un relevé : espèces ou mobile money au numéro du commerce.
function fakeDb(payoutPhone: string | null) {
  const updates: Record<string, unknown>[] = [];
  const prisma = {
    restaurantSettlement: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === "s1" ? { restaurant: { payoutPhone } } : null),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { id: "s1", ...data };
      },
    },
  } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.staff = { name: "Awa" };
    next();
  });
  app.use(adminFinanceRouter(prisma));
  return { app, updates };
}

describe("reversement des relevés", () => {
  it("par mobile money : garde le numéro du commerce, la référence et qui l'a noté", async () => {
    const { app, updates } = fakeDb("+22890112233");
    await request(app).patch("/finance/settlements/s1").send({ paid: true, method: "MOBILE_MONEY", reference: "TMONEY-42" }).expect(201);
    expect(updates[0]).toMatchObject({ payoutMethod: "MOBILE_MONEY", payoutPhone: "+22890112233", payoutRef: "TMONEY-42" });
    expect(updates[0].paidAt).toBeInstanceOf(Date);
    expect(updates[0].paidBy).toBe("Awa");
  });

  it("mobile money refusé tant que le commerce n'a pas de numéro", async () => {
    const { app, updates } = fakeDb(null);
    await request(app).patch("/finance/settlements/s1").send({ paid: true, method: "MOBILE_MONEY" }).expect(400);
    expect(updates).toHaveLength(0);
  });

  it("espèces par défaut, et annuler efface les détails", async () => {
    const { app, updates } = fakeDb(null);
    await request(app).patch("/finance/settlements/s1").send({ paid: true }).expect(201);
    expect(updates[0]).toMatchObject({ payoutMethod: "CASH", payoutPhone: null });
    await request(app).patch("/finance/settlements/s1").send({ paid: false }).expect(201);
    expect(updates[1]).toMatchObject({ paidAt: null, payoutMethod: null, payoutRef: null });
  });

  it("le numéro de reversement est un numéro du Togo, ou vide", () => {
    expect(payoutPhoneInput.parse("90 11 22 33")).toBe("+22890112233");
    expect(payoutPhoneInput.parse("")).toBeNull();
    expect(payoutPhoneInput.safeParse("12").success).toBe(false);
  });
});
