import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { staffMay } from "./team.js";

// Page « Santé » du back-office : base de données, activité du jour, dernière activité, terrain.
describe("santé de la plateforme", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const at = new Date("2026-11-04T10:00:00Z");
  const driverWheres: Record<string, unknown>[] = [];
  const last = (field: string) => async () => ({ [field]: at });
  const prisma = {
    order: {
      count: async ({ where }: { where: Record<string, unknown> }) => (where.type === "FOOD" ? 12 : where.type === "PARCEL" ? 4 : 2),
      findFirst: last("createdAt"),
    },
    zedRide: { count: async () => 7, findFirst: async () => null },
    driver: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        driverWheres.push(where);
        if (where.orders) return 1;
        return where.OR ? 3 : 9;
      },
      findFirst: last("lastSeenAt"),
    },
    customer: { findFirst: last("lastLoginAt") },
    restaurantStaff: { findFirst: async () => null },
    teamMember: { findFirst: last("lastLoginAt"), findMany: async () => [] },
    pushSubscription: { count: async () => 5 },
    staffNotification: { count: async () => 6 },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });

  it("rassemble la base, le jour, la dernière activité et le terrain", async () => {
    const login = await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
    const res = await request(app).get("/api/admin/health").set({ authorization: `Bearer ${login.body.token}` }).expect(200);
    expect(res.body.db.ok).toBe(true);
    expect(typeof res.body.db.ms).toBe("number");
    expect(res.body.today).toEqual({ orders: 12, parcels: 4, rides: 7 });
    expect(res.body.last).toEqual({
      order: at.toISOString(),
      parcel: at.toISOString(),
      ride: null,
      driver: at.toISOString(),
      customer: at.toISOString(),
      restaurant: null,
      staff: at.toISOString(),
    });
    expect(res.body.field).toEqual({ driversOnline: 9, driversOnlineNoSignal: 3, driversBusyNoSignal: 1, ordersLate: 2, pushDevices: 5, alerts24h: 6 });
    // Seuls les livreurs actifs, validés et non supprimés comptent.
    for (const w of driverWheres) expect(w).toMatchObject({ active: true, status: "APPROVED", deletedAt: null });
  });

  it("réservée au directeur et à l'adjoint", () => {
    expect(staffMay("DIRECTOR", "GET", "/health")).toBe(true);
    expect(staffMay("DEPUTY", "GET", "/health")).toBe(true);
    expect(staffMay("MANAGER", "GET", "/health")).toBe(false);
    expect(staffMay("DISPATCHER", "GET", "/health")).toBe(false);
    // Express trouve /Team comme /team : la règle ne doit pas céder à une majuscule.
    expect(staffMay("DEPUTY", "PATCH", "/Team/m1")).toBe(false);
    expect(staffMay("DEPUTY", "POST", "/FINANCE/deposits")).toBe(false);
    expect(staffMay("DEPUTY", "PATCH", "/Settings")).toBe(false);
  });
});
