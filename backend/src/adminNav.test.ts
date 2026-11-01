import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// Compteurs du menu latéral de l'admin : livreurs libres / en course, restaurants ouverts / fermés, etc.
describe("compteurs du menu admin", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const driverWheres: Record<string, unknown>[] = [];
  const count = (n: number) => async () => n;
  const prisma = {
    order: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.type === "PARCEL") return where.locationRequest ? 1 : 3;
        if (where.status === "PENDING") return 2;
        if (where.status === "DELIVERED") return 4;
        return where.driverId === null ? 5 : 6;
      },
    },
    driverIssue: { count: count(1) },
    driver: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        driverWheres.push(where);
        if (where.status === "PENDING") return 7;
        return where.online ? 8 : 9;
      },
    },
    restaurant: {
      findMany: async () => [
        { active: true, temporarilyClosed: false, closedUntil: null, openingHours: [] },
        { active: true, temporarilyClosed: false, closedUntil: null, openingHours: [] },
        { active: true, temporarilyClosed: true, closedUntil: null, openingHours: [] },
      ],
    },
    vendorApplication: { count: count(10) },
    supportRequest: { count: async ({ where }: { where: Record<string, unknown> }) => (where.priority === "URGENT" ? 11 : 12) },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });

  it("donne l'activité de chaque entrée du menu", async () => {
    const login = await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
    const res = await request(app).get("/api/admin/nav").set({ authorization: `Bearer ${login.body.token}` }).expect(200);
    expect(res.body).toEqual({
      newOrders: 2,
      ordersInProgress: 6,
      toDispatch: 5,
      driverIssues: 1,
      parcelsInProgress: 3,
      parcelsAwaitingPosition: 1,
      pendingDrivers: 7,
      driversFree: 8,
      driversBusy: 9,
      restaurantsOpen: 2,
      restaurantsClosed: 1,
      cashOrders: 4,
      pendingVendors: 10,
      openRequests: 12,
      urgentRequests: 11,
    });
    // Libres : en ligne sans course ; occupés : une course en cours ; jamais les comptes supprimés ou désactivés.
    const free = driverWheres.find((w) => w.online);
    expect(free).toMatchObject({ active: true, status: "APPROVED", deletedAt: null, orders: { none: {} } });
    const busy = driverWheres.find((w) => !w.online && w.status === "APPROVED");
    expect(busy).toMatchObject({ active: true, deletedAt: null, orders: { some: {} } });
  });
});
