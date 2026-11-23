import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { bucketOf, createMetrics, histIndex, percentileFromHist, routeName } from "./apiMetrics.js";
import { checkPerfAlerts } from "./perfReport.js";
import { staffMay } from "./team.js";

// Suivi de la performance de l'API : compteurs en mémoire, puis ajout dans D1 par une seule requête.
describe("mesures de l'API", () => {
  it("donne un nom de route sans identifiant", () => {
    expect(routeName({ method: "get", baseUrl: "/api", originalUrl: "/api/orders/ZD-AB12", route: { path: "/orders/:code" } })).toBe("GET /api/orders/:code");
    expect(routeName({ method: "POST", baseUrl: "", originalUrl: "/api/orders/cm1x2y3z4abcdefghijk/rate?x=1" })).toBe("POST /api/orders/:id (sans route)");
  });

  it("range les durées par tranche et estime les centiles", () => {
    expect(histIndex(10)).toBe(0);
    expect(histIndex(150)).toBe(2);
    expect(histIndex(9000)).toBe(7);
    // 100 réponses : 90 sous 50 ms, 10 entre 500 ms et 1 s.
    const hist = [90, 0, 0, 0, 10, 0, 0, 0];
    expect(percentileFromHist(hist, 0.5)).toBeLessThan(50);
    expect(percentileFromHist(hist, 0.95)).toBe(750);
    expect(percentileFromHist([0, 0, 0, 0, 0, 0, 0, 0], 0.95)).toBeNull();
  });

  it("additionne en mémoire puis écrit tout en une requête, ajoutée aux lignes existantes", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const prisma = { $executeRawUnsafe: async (sql: string, ...params: unknown[]) => calls.push({ sql, params }) } as unknown as PrismaClient;
    const t = Date.UTC(2026, 10, 23, 10, 2);
    const m = createMetrics(prisma, { now: () => t });
    m.record("GET /api/restaurants", 200, 40);
    m.record("GET /api/restaurants", 200, 600);
    m.record("GET /api/restaurants", 503, 20);
    m.record("POST /api/orders", 400, 120);
    expect(m.pending()).toHaveLength(2);
    await m.flush();
    expect(m.pending()).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("ON CONFLICT");
    expect(calls[0].sql).toContain('"count" = "count" + excluded."count"');
    // bucket, route, count, errors, clientErrors, totalMs, maxMs, h50…hMore
    expect(calls[0].params.slice(0, 15)).toEqual([bucketOf(t), "GET /api/restaurants", 3, 1, 0, 660, 600, 2, 0, 0, 0, 1, 0, 0, 0]);
    expect(calls[0].params.slice(15, 20)).toEqual([bucketOf(t), "POST /api/orders", 1, 0, 1]);
  });

  it("envoie les compteurs d'elle-même deux minutes après la première réponse", async () => {
    let writes = 0;
    const prisma = { $executeRawUnsafe: async () => writes++ } as unknown as PrismaClient;
    let now = 1_000_000;
    const background: Promise<unknown>[] = [];
    const m = createMetrics(prisma, { now: () => now, background: (p) => background.push(p) });
    m.record("GET /api/x", 200, 10);
    now += 60_000;
    m.record("GET /api/x", 200, 10);
    expect(background).toHaveLength(0);
    now += 61_000;
    m.record("GET /api/x", 200, 10);
    await Promise.all(background);
    expect(writes).toBe(1);
  });

  it("compte les réponses de l'application Express", async () => {
    const recorded: [string, number][] = [];
    const metrics = { record: (route: string, status: number) => recorded.push([route, status]), flush: async () => {}, heartbeat: async () => {}, pending: () => [] };
    const app = createApp({} as PrismaClient, { frontendOrigin: "", zedekaWhatsapp: "", metrics });
    await request(app).get("/api/health").expect(200);
    await request(app).get("/api/n-existe-pas/123").expect(404);
    expect(recorded).toEqual([
      ["GET /api/health", 200],
      ["GET /api/n-existe-pas/:id (sans route)", 404],
    ]);
  });

  it("pages Indicateurs et Performance : directeur et adjoint seulement", () => {
    for (const path of ["/kpi", "/perf"]) {
      expect(staffMay("DIRECTOR", "GET", path)).toBe(true);
      expect(staffMay("DEPUTY", "GET", path)).toBe(true);
      expect(staffMay("MANAGER", "GET", path)).toBe(false);
      expect(staffMay("DISPATCHER", "GET", path)).toBe(false);
    }
  });
});

describe("alertes de performance", () => {
  const sums = (s: Record<string, number>) => ({ _sum: { count: 0, errors: 0, clientErrors: 0, totalMs: 0, h50: 0, h100: 0, h200: 0, h500: 0, h1000: 0, h2000: 0, h5000: 0, hMore: 0, ...s }, _max: { maxMs: 0 } });

  function setup(api: Record<string, number>, db: Record<string, number>, recent = false) {
    const sent: { category: string; title: string }[] = [];
    const prisma = {
      apiMetric: { aggregate: async ({ where }: { where: { route: unknown } }) => (where.route === "cron" ? sums(db) : sums(api)) },
      staffNotification: { findFirst: async () => (recent ? { id: "n1" } : null) },
    } as unknown as PrismaClient;
    const notifier = { publicKey: "", push: async () => 0, sms: async () => {}, staff: async (category: string, p: { title: string }) => (sent.push({ category, title: p.title }), 1) };
    return { prisma, notifier, sent };
  }

  it("prévient l'équipe quand les erreurs du serveur dépassent 5 %", async () => {
    const { prisma, notifier, sent } = setup({ count: 100, errors: 8, h50: 100 }, { count: 15, totalMs: 300 });
    expect(await checkPerfAlerts(prisma, notifier)).toEqual(["Erreurs du serveur élevées"]);
    expect(sent).toEqual([{ category: "TECH", title: "Erreurs du serveur élevées" }]);
  });

  it("signale une API et une base lentes", async () => {
    const { prisma, notifier } = setup({ count: 50, hMore: 10, h50: 40 }, { count: 15, totalMs: 15 * 2000 });
    expect(await checkPerfAlerts(prisma, notifier)).toEqual(["API lente", "Base de données lente"]);
  });

  it("se tait quand tout va bien, ou si la même alerte est partie il y a moins d'une heure", async () => {
    expect(await checkPerfAlerts(setup({ count: 100, errors: 1, h50: 100 }, { count: 15, totalMs: 200 }).prisma, setup({}, {}).notifier)).toEqual([]);
    const again = setup({ count: 100, errors: 20, h50: 100 }, { count: 15 }, true);
    expect(await checkPerfAlerts(again.prisma, again.notifier)).toEqual([]);
    expect(again.sent).toEqual([]);
  });
});
