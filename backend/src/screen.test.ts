import type { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { readLiveTicket } from "./live.js";
import { screenRouter } from "./routes/screen.js";
import { buildSummary, categoryOf, dailyGoal, hashScreenKey, history, isScreenKey, newScreenKey, shortName, type ScreenOrder } from "./screen.js";
import { staffMay } from "./team.js";

const NOW = new Date("2026-11-22T15:30:00Z");
const at = (iso: string) => new Date(iso);

describe("écran du bureau : calculs", () => {
  it("clé : 32 caractères, empreinte stable, forme vérifiée", () => {
    const key = newScreenKey();
    expect(isScreenKey(key)).toBe(true);
    expect(hashScreenKey(key)).toBe(hashScreenKey(key));
    expect(hashScreenKey(key)).not.toBe(hashScreenKey(newScreenKey()));
    expect(isScreenKey("trop-court")).toBe(false);
    expect(isScreenKey(`${key.slice(0, 31)}/`)).toBe(false);
  });

  it("prénom et initiale du nom seulement", () => {
    expect(shortName("Kossi Mensah")).toBe("Kossi M.");
    expect(shortName("  Ama  ")).toBe("Ama");
    expect(shortName("Yao Kodjo agbeko")).toBe("Yao A.");
    expect(shortName("")).toBe("Livreur");
  });

  it("objectif : celui du directeur, sinon moyenne des 7 jours + 10 %, arrondie aux 5 (au moins 10)", () => {
    expect(dailyGoal(80, [10, 10])).toEqual({ goal: 80, auto: false });
    expect(dailyGoal(0, [40, 40, 40, 40, 40, 40, 40])).toEqual({ goal: 45, auto: true });
    expect(dailyGoal(0, [0, 0, 0, 0, 0, 0, 0])).toEqual({ goal: 10, auto: true });
  });

  it("record et 7 derniers jours (jours vides compris)", () => {
    const days = [
      ...Array.from({ length: 5 }, () => at("2026-11-21T10:00:00Z")),
      ...Array.from({ length: 9 }, () => at("2026-11-02T12:00:00Z")),
      at("2026-11-19T12:00:00Z"),
    ];
    const { record, last7 } = history(days, NOW);
    expect(record).toEqual({ count: 9, date: "2026-11-02" });
    expect(last7).toEqual([5, 0, 1, 0, 0, 0, 0]);
    expect(history([], NOW).record).toBeNull();
  });

  it("repas, colis ou boutique", () => {
    expect(categoryOf({ type: "FOOD", storeSale: false, restaurant: { name: "A", kind: "RESTAURANT" } })).toBe("FOOD");
    expect(categoryOf({ type: "PARCEL", storeSale: false, restaurant: null })).toBe("PARCEL");
    expect(categoryOf({ type: "PARCEL", storeSale: true, restaurant: { name: "B", kind: "SHOP" } })).toBe("SHOP");
  });

  const order = (over: Partial<ScreenOrder>): ScreenOrder => ({
    code: "ZD-AAAA",
    type: "FOOD",
    status: "DELIVERED",
    storeSale: false,
    fulfillment: "DELIVERY",
    createdAt: at("2026-11-22T12:00:00Z"),
    pickedUpAt: at("2026-11-22T12:20:00Z"),
    deliveredAt: at("2026-11-22T12:30:00Z"),
    driverId: "d1",
    restaurant: { name: "Chez Tante Ama", kind: "RESTAURANT" },
    zone: { name: "Bè" },
    ...over,
  });

  it("chiffres du jour, classement et fil sans données du client", () => {
    const summary = buildSummary({
      now: NOW,
      orders: [
        order({ code: "ZD-0001" }),
        order({ code: "ZD-0002", driverId: "d2", pickedUpAt: at("2026-11-22T12:25:00Z") }),
        order({ code: "ZD-0003", driverId: "d2", createdAt: at("2026-11-22T14:00:00Z"), pickedUpAt: at("2026-11-22T14:20:00Z"), deliveredAt: at("2026-11-22T14:40:00Z") }),
        order({ code: "ZD-0004", type: "PARCEL", restaurant: null, status: "PICKED_UP", deliveredAt: null, createdAt: at("2026-11-22T15:00:00Z") }),
        order({ code: "ZD-0005", status: "CANCELLED", deliveredAt: null, driverId: null }),
        // Commandée hier soir, livrée ce matin : compte dans les livraisons du jour, pas dans les commandes reçues.
        order({ code: "ZD-0006", createdAt: at("2026-11-21T23:50:00Z"), pickedUpAt: null, deliveredAt: at("2026-11-22T00:20:00Z"), driverId: "d3" }),
      ],
      yesterdayCreated: [at("2026-11-21T09:00:00Z"), at("2026-11-21T20:00:00Z")],
      yesterdayDeliveredSoFar: 1,
      past: { record: { count: 12, date: "2026-11-02" }, last7: [3, 4, 5, 6, 7, 8, 9] },
      goalSetting: 0,
      drivers: new Map([
        ["d1", "Kossi Mensah"],
        ["d2", "Ama Dogbe"],
        ["d3", "Yao Kpodo"],
      ]),
      zedRides: 2,
    });
    expect(summary.today).toEqual({ received: 5, delivered: 4, inProgress: 1, cancelled: 1, byCategory: { FOOD: 4, PARCEL: 1, SHOP: 0 }, avgMinutes: 33, zedRides: 2 });
    expect(summary.yesterday).toEqual({ createdSoFar: 1, deliveredSoFar: 1 });
    expect(summary.goal).toEqual({ target: 10, auto: true });
    expect(summary.leaderboard.map((l) => [l.name, l.deliveries, l.avgMinutes])).toEqual([
      ["Ama D.", 2, 13],
      ["Kossi M.", 1, 10],
      ["Yao K.", 1, null],
    ]);
    expect(summary.feed[0]).toEqual({ code: "ZD-0004", category: "PARCEL", from: null, zone: "Bè", status: "PICKED_UP", createdAt: "2026-11-22T15:00:00.000Z", deliveredAt: null });
    expect(summary.hourly[12]).toBe(3);
    expect(summary.hourlyYesterday[20]).toBe(1);
    // Rien de personnel dans la réponse.
    const text = JSON.stringify(summary);
    for (const word of ["customer", "phone", "address", "Mensah", "latitude"]) expect(text).not.toContain(word);
  });
});

describe("écran du bureau : accès", () => {
  const SECRET = "s".repeat(64);
  const key = newScreenKey();
  const screens = [{ id: "e1", name: "Bureau", keyHash: hashScreenKey(key), lastSeenAt: null as Date | null, revokedAt: null as Date | null }];
  const prisma = {
    displayScreen: {
      findUnique: async ({ where }: { where: { keyHash: string } }) => screens.find((s) => s.keyHash === where.keyHash) ?? null,
      update: async ({ data }: { data: { lastSeenAt: Date } }) => Object.assign(screens[0], data),
    },
    order: { findMany: async () => [], count: async () => 0 },
    restaurant: {
      findMany: async () => [
        { id: "r1", name: "Chez Tante Ama", kind: "RESTAURANT", latitude: 6.13, longitude: 1.22, active: true, temporarilyClosed: false, closedUntil: null, openingHours: [] },
        { id: "r2", name: "Sans position", kind: "SHOP", latitude: null, longitude: null, active: true, temporarilyClosed: true, closedUntil: null, openingHours: [] },
      ],
    },
    driver: {
      findMany: async () => [
        { id: "d1", name: "Kossi Mensah", online: true, vehicle: "MOTO", lastLatitude: 6.14, lastLongitude: 1.21, lastLocationAt: new Date(NOW.getTime() - 60_000) },
        { id: "d2", name: "Ama Dogbe", online: true, vehicle: "MOTO", lastLatitude: 6.15, lastLongitude: 1.2, lastLocationAt: new Date(NOW.getTime() - 3_600_000) },
      ],
    },
    settings: { findFirst: async () => ({ id: 1, screenDailyGoal: 50 }) },
    zedRide: { count: async () => 0 },
  } as unknown as PrismaClient;
  const app = express().use("/api/screen", screenRouter(prisma, { secret: SECRET, now: () => NOW }));

  it("refuse sans clé, avec une clé inconnue ou révoquée", async () => {
    await request(app).get("/api/screen/summary").expect(401);
    await request(app).get("/api/screen/summary").set("x-screen-key", newScreenKey()).expect(401);
    screens[0].revokedAt = NOW;
    await request(app).get("/api/screen/summary").set("x-screen-key", key).expect(401);
    screens[0].revokedAt = null;
  });

  it("donne le résumé, la carte et un ticket temps réel limité au canal de l'équipe", async () => {
    const summary = await request(app).get("/api/screen/summary").set("x-screen-key", key).expect(200);
    expect(summary.body.goal).toEqual({ target: 50, auto: false });
    expect(screens[0].lastSeenAt).toEqual(NOW);

    const map = await request(app).get("/api/screen/map").set("x-screen-key", key).expect(200);
    expect(map.body.restaurants).toEqual([{ id: "r1", name: "Chez Tante Ama", kind: "RESTAURANT", open: true, activeOrders: 0, latitude: 6.13, longitude: 1.22 }]);
    expect(map.body.drivers.map((d: { name: string; state: string }) => [d.name, d.state])).toEqual([
      ["Kossi M.", "FREE"],
      ["Ama D.", "STALE"],
    ]);
    expect(map.body.counts).toMatchObject({ driversOnline: 2, driversFree: 1, restaurantsOpen: 1 });
    expect(JSON.stringify(map.body)).not.toContain("phone");

    const live = await request(app).get("/api/screen/realtime").set("x-screen-key", key).expect(200);
    expect(readLiveTicket(live.body.ticket, SECRET, NOW.getTime())).toEqual(["admin"]);
  });
});

describe("écran du bureau : gestion dans l'admin", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const created: Record<string, unknown>[] = [];
  const prisma = {
    displayScreen: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "e1", name: data.name, keyHint: data.keyHint, createdBy: data.createdBy, createdAt: NOW, lastSeenAt: null, revokedAt: null };
      },
    },
    settings: { findFirst: async () => ({ id: 1, screenDailyGoal: 0 }), update: async () => ({}) },
    teamMember: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "https://zedeka.example", zedekaWhatsapp: "", ...STRONG });

  it("crée un lien dont seule l'empreinte de la clé est gardée", async () => {
    const login = await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
    const res = await request(app).post("/api/admin/screens").set({ authorization: `Bearer ${login.body.token}` }).send({ name: "Grand écran" }).expect(201);
    expect(res.body.url).toBe(`https://zedeka.example/ecran?cle=${res.body.key}`);
    expect(created[0]).toMatchObject({ name: "Grand écran", keyHash: hashScreenKey(res.body.key), keyHint: res.body.key.slice(-4) });
    expect(JSON.stringify(created[0])).not.toContain(res.body.key);
    await request(app).put("/api/admin/screens/goal").set({ authorization: `Bearer ${login.body.token}` }).send({ goal: -1 }).expect(400);
  });

  it("écriture réservée au directeur, lecture pour l'adjoint", () => {
    expect(staffMay("DIRECTOR", "POST", "/screens")).toBe(true);
    expect(staffMay("DEPUTY", "GET", "/screens")).toBe(true);
    expect(staffMay("DEPUTY", "POST", "/screens")).toBe(false);
    expect(staffMay("DEPUTY", "PUT", "/screens/goal")).toBe(false);
    expect(staffMay("MANAGER", "GET", "/screens")).toBe(false);
    expect(staffMay("DISPATCHER", "GET", "/screens")).toBe(false);
  });
});
