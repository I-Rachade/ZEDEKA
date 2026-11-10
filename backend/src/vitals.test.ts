import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { p75, vitalsSummary } from "./routes/vitals.js";

// Vitesse réelle des pages : mesures envoyées par les téléphones, résumées dans la page « Santé ».
describe("mesures de vitesse", () => {
  const saved: unknown[] = [];
  const prisma = { webVital: { createMany: async ({ data }: { data: unknown[] }) => saved.push(...data) } } as unknown as PrismaClient;
  const app = createApp(prisma, { adminPassword: "x".repeat(20), adminSecret: "a".repeat(64) });

  it("enregistre un lot envoyé en texte (sendBeacon)", async () => {
    const body = JSON.stringify([
      { page: "/r/[slug]", name: "LCP", value: 2412.3456, connection: "4g" },
      { page: "/app", name: "CLS", value: 0.05 },
    ]);
    await request(app).post("/api/vitals").set("Content-Type", "text/plain").send(body).expect(204);
    expect(saved).toEqual([
      { page: "/r/[slug]", name: "LCP", value: 2412.346, connection: "4g" },
      { page: "/app", name: "CLS", value: 0.05 },
    ]);
  });

  it("refuse une page ou une mesure inconnue", async () => {
    await request(app).post("/api/vitals").set("Content-Type", "text/plain").send(JSON.stringify([{ page: "https://x", name: "LCP", value: 1 }])).expect(400);
    await request(app).post("/api/vitals").set("Content-Type", "text/plain").send(JSON.stringify([{ page: "/app", name: "XYZ", value: 1 }])).expect(400);
    await request(app).post("/api/vitals").set("Content-Type", "text/plain").send("pas du json").expect(400);
  });

  it("75e centile par page", async () => {
    expect(p75([])).toBeNull();
    expect(p75([400, 100, 300, 200])).toBe(300);
    const rows = [100, 200, 300, 400].map((value) => ({ page: "/app", name: "LCP", value }));
    const db = { webVital: { findMany: async () => [...rows, { page: "/app", name: "TTFB", value: 50 }] } } as unknown as PrismaClient;
    expect(await vitalsSummary(db)).toEqual([{ page: "/app", visits: 4, LCP: 300, FCP: null, TTFB: 50, INP: null, CLS: null }]);
  });
});
