import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { readLiveTicket } from "./live.js";
import { hashScreenKey, newScreenKey } from "./screen.js";
import { vitality } from "./techScreen.js";

const SECRET = "s".repeat(40);

describe("vitalité de l'appli", () => {
  const perfect = { availability24h: 100, errorRate1h: 0, p95Ms1h: 400, dbMs: 40, lastBeatAgoSec: 30, realtime: true, audit: { critical: 0, high: 0 } };

  it("donne 100 quand tout va bien", () => {
    const v = vitality(perfect);
    expect(v.score).toBe(100);
    expect(v.level).toBe("good");
  });

  it("baisse avec les erreurs, la lenteur et les failles", () => {
    // 2,75 % d'erreurs : la moitié des 20 points ; 95 % des réponses en 2 s : la moitié des 15 points.
    expect(vitality({ ...perfect, errorRate1h: 2.75, p95Ms1h: 2000 }).score).toBe(83);
    // Une faille haute : 6 points sur 15 ; une critique : 0.
    expect(vitality({ ...perfect, audit: { critical: 0, high: 1 } }).score).toBe(91);
    expect(vitality({ ...perfect, audit: { critical: 1, high: 0 } }).level).toBe("warn");
  });

  it("passe au rouge quand l'appli ne répond plus", () => {
    const v = vitality({ ...perfect, availability24h: 94, errorRate1h: 12, lastBeatAgoSec: null, realtime: false });
    expect(v.score).toBe(40);
    expect(v.level).toBe("bad");
  });

  it("ne pénalise pas une mesure absente (pas encore de trafic), sauf le cron et le temps réel", () => {
    expect(vitality({ ...perfect, availability24h: null, errorRate1h: null, p95Ms1h: null, dbMs: null, audit: null }).score).toBe(100);
  });
});

describe("écran technique : accès", () => {
  function setup(kind: "OFFICE" | "TECH") {
    const key = newScreenKey();
    const prisma = {
      displayScreen: {
        findUnique: async ({ where }: { where: { keyHash: string } }) =>
          where.keyHash === hashScreenKey(key) ? { id: "e1", name: "Mur technique", lastSeenAt: new Date(), revokedAt: null, kind } : null,
        update: async () => ({}),
      },
    } as unknown as PrismaClient;
    return { key, app: createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: SECRET }) };
  }

  it("refuse une clé d'écran du bureau et un écran inconnu", async () => {
    const { key, app } = setup("OFFICE");
    await request(app).get("/api/screen/tech").set("x-screen-key", key).expect(403);
    await request(app).get("/api/screen/tech/realtime").set("x-screen-key", key).expect(403);
    await request(app).get("/api/screen/tech").set("x-screen-key", newScreenKey()).expect(401);
  });

  it("donne à un écran technique son type et un ticket temps réel « tech »", async () => {
    const { key, app } = setup("TECH");
    expect((await request(app).get("/api/screen/me").set("x-screen-key", key).expect(200)).body).toEqual({ name: "Mur technique", kind: "TECH" });
    const res = await request(app).get("/api/screen/tech/realtime").set("x-screen-key", key).expect(200);
    expect(readLiveTicket(res.body.ticket, SECRET)).toEqual(["tech", "admin"]);
  });
});
