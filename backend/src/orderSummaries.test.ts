import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// Historique sans compte : toutes les commandes de l'appareil en un seul appel.
describe("résumés de commandes", () => {
  it("lit au plus 10 codes, en une requête", async () => {
    const asked: unknown[] = [];
    const prisma = {
      order: {
        findMany: async (args: { where: { code: { in: string[] } } }) => {
          asked.push(args.where.code.in);
          return [{ code: "ZD-AAAA", type: "FOOD", status: "DELIVERED", total: 3000, createdAt: new Date(0), restaurant: { name: "Chez A" }, zone: { name: "Bè" }, items: [] }];
        },
      },
    } as unknown as PrismaClient;
    const app = createApp(prisma, { frontendOrigin: "http://localhost", zedekaWhatsapp: "" });
    const codes = Array.from({ length: 12 }, (_, i) => `zd-${i}`).join(",");
    const res = await request(app).get(`/api/orders/summaries?codes=${codes}`).expect(200);
    expect(res.body[0].code).toBe("ZD-AAAA");
    expect(asked).toHaveLength(1);
    expect((asked[0] as string[]).length).toBe(10);
    await request(app).get("/api/orders/summaries").expect(200, []);
  });
});
