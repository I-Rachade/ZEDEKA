import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { bucketOf } from "./apiMetrics.js";
import { cleanMessage, createErrorLog, fingerprintOf, recentErrors, type ErrorInput, type ErrorLog } from "./errorLog.js";
import { readLiveTicket } from "./live.js";
import { onlineNow, sampleOnline } from "./techSamples.js";
import { staffMay } from "./team.js";
import { techLive } from "./routes/adminTech.js";

const SECRET = "s".repeat(40);

describe("journal des erreurs", () => {
  it("retire du message les chiffres, adresses e-mail, liens et identifiants", () => {
    expect(cleanMessage(new Error("Commande ZD-4521 introuvable pour +22890112233"))).toBe("Commande ZD-# introuvable pour +#");
    expect(cleanMessage("Échec https://api.exemple.tg/x?token=abc envoi à ama@exemple.tg")).toBe("Échec <lien> envoi à <e-mail>");
    expect(cleanMessage("Client cm1x2y3z4abcdefghijk absent")).toBe("Client <id> absent");
    expect(cleanMessage("")).toBe("Erreur sans message");
    expect(cleanMessage("trop long ".repeat(40))).toHaveLength(160);
  });

  it("regroupe les erreurs identiques et les écrit tout de suite, en une requête", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const prisma = { $executeRawUnsafe: async (sql: string, ...params: unknown[]) => calls.push({ sql, params }) } as unknown as PrismaClient;
    const t = Date.UTC(2026, 10, 23, 6, 41);
    let written = 0;
    const background: Promise<unknown>[] = [];
    const log = createErrorLog(prisma, { now: () => t, background: (p) => background.push(p), onWritten: () => written++ });
    const e: ErrorInput = { source: "api", route: "POST /api/orders", status: 500, message: "Délai dépassé 3000 ms" };
    log.record(e);
    log.record(e);
    log.record({ ...e, message: "Délai dépassé 4500 ms" }); // même message une fois les chiffres retirés
    await Promise.all(background);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('"count" = "count" + excluded."count"');
    const fp = fingerprintOf({ source: "api", route: "POST /api/orders", status: 500, message: "Délai dépassé # ms" });
    expect(calls[0].params).toEqual([bucketOf(t), fp, "api", "POST /api/orders", 500, "Délai dépassé # ms", 3, Math.floor(t / 1000)]);
    expect(written).toBe(1);
  });

  it("garde au plus 100 erreurs différentes, le reste dans « autres erreurs »", () => {
    let release: () => void = () => {};
    const prisma = { $executeRawUnsafe: () => new Promise<void>((r) => (release = r)) } as unknown as PrismaClient;
    const log = createErrorLog(prisma, { now: () => 1_000_000 });
    // L'écriture attend un peu (rafale) puis reste en cours : tout s'accumule en mémoire.
    log.record({ source: "api", route: "r", status: 500, message: "premier" });
    for (let i = 0; i < 150; i++) log.record({ source: "api", route: `GET /api/r${"x".repeat(i % 26)}${i}`, status: 500, message: "boom" });
    const pending = log.pending();
    expect(pending.length).toBe(100);
    // « premier » + 98 erreurs distinctes, les 52 suivantes regroupées.
    expect(pending.find((r) => r.fingerprint === "autres")?.count).toBe(52);
    release();
  });

  it("entre chaque réponse 5xx de l'API dans le journal, avec le message de l'erreur", async () => {
    const recorded: ErrorInput[] = [];
    const errorLog: ErrorLog = { record: (e) => recorded.push(e), flush: async () => {}, pending: () => [] };
    // Une base qui lève à chaque lecture : la route publique répond 500.
    const prisma = new Proxy({}, { get: () => new Proxy(() => {}, { get: () => async () => { throw new Error("D1_ERROR: base indisponible"); }, apply: () => { throw new Error("D1_ERROR"); } }) }) as unknown as PrismaClient;
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", errorLog });
    await request(app).get("/api/health").expect(200);
    await request(app).get("/api/zones").expect(500);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ source: "api", status: 500 });
    expect(recorded[0].message).toContain("base indisponible");
  });

  it("reçoit les plantages d'écran des applis et refuse le reste", async () => {
    const recorded: ErrorInput[] = [];
    const errorLog: ErrorLog = { record: (e) => recorded.push(e), flush: async () => {}, pending: () => [] };
    const app = createApp({} as PrismaClient, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: SECRET, errorLog });
    await request(app)
      .post("/api/client-errors")
      .set("Content-Type", "text/plain")
      .send(JSON.stringify([{ app: "livreur", page: "/livreur/course/[id]", message: "Cannot read properties of null (reading 'lat')" }]))
      .expect(204);
    expect(recorded).toEqual([{ source: "livreur", route: "/livreur/course/[id]", status: 0, message: "Cannot read properties of null (reading 'lat')" }]);
    await request(app).post("/api/client-errors").set("Content-Type", "text/plain").send(JSON.stringify([{ app: "pirate", page: "/", message: "x" }])).expect(400);
    await request(app).post("/api/client-errors").set("Content-Type", "text/plain").send("pas du json").expect(400);
  });

  it("lit les erreurs récentes regroupées par empreinte", async () => {
    const now = new Date(Date.UTC(2026, 10, 23, 7));
    const s = Math.floor(now.getTime() / 1000);
    const prisma = {
      errorEvent: {
        findMany: async () => [
          { bucket: 1, fingerprint: "a", source: "api", route: "POST /api/orders", status: 500, message: "m", count: 4, lastAt: s - 60 },
          { bucket: 2, fingerprint: "b", source: "livreur", route: "/livreur", status: 0, message: "n", count: 1, lastAt: s - 120 },
          { bucket: 0, fingerprint: "a", source: "api", route: "POST /api/orders", status: 500, message: "m", count: 2, lastAt: s - 900 },
        ],
      },
    } as unknown as PrismaClient;
    const list = await recentErrors(prisma, 60, 30, now);
    expect(list.map((e) => [e.fingerprint, e.count])).toEqual([
      ["a", 6],
      ["b", 1],
    ]);
  });
});

describe("utilisateurs en ligne et actifs du jour", () => {
  it("donne un ticket de présence pour une appli connue et compte l'appareil une fois par jour", async () => {
    const inserts: unknown[][] = [];
    const prisma = { $executeRawUnsafe: async (_sql: string, ...p: unknown[]) => inserts.push(p) } as unknown as PrismaClient;
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: SECRET });
    const res = await request(app).get("/api/presence?app=client&d=appareil-12345678").expect(200);
    expect(readLiveTicket(res.body.ticket, SECRET)).toEqual(["presence:client"]);
    await request(app).get("/api/presence?app=client&d=appareil-12345678").expect(200);
    await request(app).get("/api/presence?app=livreur&d=appareil-12345678").expect(200);
    expect(inserts).toHaveLength(2);
    // Empreinte de l'appareil, jamais son identifiant.
    expect(JSON.stringify(inserts)).not.toContain("appareil-12345678");
    await request(app).get("/api/presence?app=pirate").expect(400);
  });

  it("compte les connexions par appli et écrit les relevés toutes les 5 minutes", async () => {
    expect(await onlineNow(undefined)).toBeNull();
    expect(await onlineNow(async () => ({ client: 10, livreur: 3, admin: 1 }))).toEqual({ total: 14, byApp: { client: 10, livreur: 3, restaurant: 0, marchand: 0, admin: 1 } });
    const calls: unknown[][] = [];
    const prisma = { $executeRawUnsafe: async (_sql: string, ...p: unknown[]) => calls.push(p) } as unknown as PrismaClient;
    const t = Date.UTC(2026, 10, 23, 6, 44);
    await sampleOnline(prisma, async () => ({ client: 2 }), t);
    expect(calls[0].slice(0, 3)).toEqual([bucketOf(t), "online:total", 2]);
    expect(calls[0]).toContain("online:client");
  });

  it("résume l'écran « en direct » : en ligne, actifs du jour, même heure la semaine dernière", async () => {
    const now = new Date(Date.UTC(2026, 10, 23, 6, 42));
    const s = Math.floor(now.getTime() / 1000);
    const week = 7 * 86_400;
    const prisma = {
      activeDay: { groupBy: async () => [{ app: "client", _count: { _all: 40 } }, { app: "livreur", _count: { _all: 5 } }] },
      techSample: {
        findMany: async ({ where }: { where: { bucket: { gte: number } } }) =>
          where.bucket.gte < s - week + 86_400 && where.bucket.gte < s - 86_400
            ? [
                { bucket: s - week - 600, value: 30 },
                { bucket: s - week - 60, value: 33 },
                { bucket: s - week + 600, value: 50 },
              ]
            : [{ bucket: s - 300, value: 37 }],
      },
      errorEvent: { findMany: async () => [] },
    } as unknown as PrismaClient;
    const live = await techLive(prisma, async () => ({ client: 30, livreur: 7 }), now);
    expect(live.online).toEqual({ total: 37, byApp: { client: 30, livreur: 7, restaurant: 0, marchand: 0, admin: 0 } });
    expect(live.onlineLastWeek).toBe(33);
    expect(live.activeToday.total).toBe(45);
    expect(live.today).toHaveLength(1);
  });

  it("écran technique « en direct » : directeur et adjoint seulement", () => {
    expect(staffMay("DIRECTOR", "GET", "/tech/live")).toBe(true);
    expect(staffMay("DEPUTY", "GET", "/tech/live")).toBe(true);
    for (const role of ["MANAGER", "DISPATCHER", "HR", "ACCOUNTANT"] as const) expect(staffMay(role, "GET", "/tech/live")).toBe(false);
  });
});
