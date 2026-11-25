import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { mayManageMember, restaurantRoleMay } from "./restaurantTeam.js";

describe("droits de l'équipe d'un restaurant", () => {
  it("la caissière voit les commandes, encaisse et prévient le livreur, sans carte, réglages, relevés ni équipe", () => {
    for (const [m, p] of [["GET", "/orders"], ["GET", "/orders/counts"], ["GET", "/orders/o1"], ["POST", "/orders/o1/status"], ["POST", "/orders/o1/paid"], ["POST", "/orders/o1/driver-message"], ["GET", "/me"], ["POST", "/push"], ["POST", "/password"]]) {
      expect(restaurantRoleMay("CASHIER", m, p)).toBe(true);
    }
    for (const [m, p] of [["GET", "/dashboard"], ["GET", "/menu"], ["POST", "/items"], ["PATCH", "/settings"], ["GET", "/settlements"], ["GET", "/team"], ["POST", "/team"], ["POST", "/orders/o1/edit"], ["PATCH", "/status"], ["GET", "/tables"]]) {
      expect(restaurantRoleMay("CASHIER", m, p)).toBe(false);
    }
    expect(restaurantRoleMay("MANAGER", "PATCH", "/settings")).toBe(true);
    expect(restaurantRoleMay("MANAGER", "POST", "/team")).toBe(true);
  });

  it("la manageuse gère les caissières, le gérant toute l'équipe", () => {
    expect(mayManageMember("OWNER", "MANAGER")).toBe(true);
    expect(mayManageMember("MANAGER", "CASHIER")).toBe(true);
    expect(mayManageMember("MANAGER", "MANAGER")).toBe(false);
    expect(mayManageMember("CASHIER", "CASHIER")).toBe(false);
  });
});

describe("connexion et accès des membres", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const restaurant = { id: "r1", name: "Chez Ama", phone: "+228 90 00 00 00", address: "Bè", ownerEmail: "gerant@ama.tg", ownerPasswordHash: bcrypt.hashSync("gerant-2026", 4), sessionsValidFrom: null, commissionRate: 10, subscriptionFee: null, openingHours: "[]", active: true, temporarilyClosed: false, closedUntil: null };
  const staff = [
    { id: "s1", restaurantId: "r1", name: "Afi", email: "afi@ama.tg", passwordHash: bcrypt.hashSync("caisse-2026", 4), role: "CASHIER", active: true, sessionsValidFrom: null as Date | null },
    { id: "s2", restaurantId: "r1", name: "Edem", email: "edem@ama.tg", passwordHash: bcrypt.hashSync("manager-2026", 4), role: "MANAGER", active: true, sessionsValidFrom: null as Date | null },
  ];
  const created: unknown[] = [];
  const orders = [{ id: "o1", restaurantId: "r1", fulfillment: "PICKUP", status: "READY", paymentStatus: "UNPAID", driverId: null }];
  const prisma = {
    restaurant: {
      findUnique: async ({ where }: { where: { id?: string; ownerEmail?: string } }) => (where.id === "r1" || where.ownerEmail === restaurant.ownerEmail ? { ...restaurant, zone: null } : null),
      update: async () => restaurant,
    },
    restaurantStaff: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        const m = staff.find((s) => s.id === where.id || s.email === where.email);
        return m ? { ...m, restaurant: { name: restaurant.name } } : null;
      },
      findFirst: async ({ where }: { where: { id: string; restaurantId: string } }) => staff.find((s) => s.id === where.id && s.restaurantId === where.restaurantId) ?? null,
      findMany: async () => staff,
      count: async () => staff.length,
      create: async ({ data }: { data: unknown }) => (created.push(data), data),
      update: async ({ data }: { data: unknown }) => data,
    },
    order: {
      findFirst: async ({ where }: { where: { id: string; restaurantId: string } }) => orders.find((o) => o.id === where.id && o.restaurantId === where.restaurantId) ?? null,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...orders[0], ...data, confirmedAt: new Date(), customerPhone: "" }),
      // Écriture conditionnelle (encaissement) : seulement si la commande n'est pas déjà payée.
      updateMany: async ({ where, data }: { where: { id: string; paymentStatus?: { not: string } }; data: Record<string, unknown> }) => {
        const o = orders.find((x) => x.id === where.id && (!where.paymentStatus || x.paymentStatus !== where.paymentStatus.not));
        if (!o) return { count: 0 };
        Object.assign(o, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...orders.find((o) => o.id === where.id)!, confirmedAt: new Date(), customerPhone: "" }),
    },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });
  const login = async (email: string, password: string) => {
    const res = await request(app).post("/api/restaurant/login").send({ email, password }).expect(200);
    return { authorization: `Bearer ${res.body.token}`, body: res.body };
  };

  it("connecte la caissière avec son e-mail et limite son accès", async () => {
    await request(app).post("/api/restaurant/login").send({ email: "afi@ama.tg", password: "faux" }).expect(401);
    const { authorization, body } = await login(" Afi@Ama.tg ", "caisse-2026");
    expect(body).toMatchObject({ role: "CASHIER", name: "Chez Ama", memberName: "Afi" });
    const me = await request(app).get("/api/restaurant/me").set({ authorization }).expect(200);
    expect(me.body.account).toEqual({ role: "CASHIER", name: "Afi", email: "afi@ama.tg" });
    expect(me.body.commissionRate).toBeUndefined();
    expect(me.body.ownerEmail).toBeUndefined();
    await request(app).get("/api/restaurant/dashboard").set({ authorization }).expect(403);
    await request(app).get("/api/restaurant/team").set({ authorization }).expect(403);
    await request(app).patch("/api/restaurant/settings").set({ authorization }).send({ minOrderAmount: 0 }).expect(403);
  });

  it("encaisse au comptoir en gardant le nom de la caissière", async () => {
    const { authorization } = await login("afi@ama.tg", "caisse-2026");
    const res = await request(app).post("/api/restaurant/orders/o1/paid").set({ authorization }).expect(200);
    expect(res.body).toMatchObject({ paymentStatus: "PAID", counterPaidBy: "Afi" });
    // Deuxième encaissement (autre caisse, double appui) : refusé, la commande reste encaissée une seule fois.
    await request(app).post("/api/restaurant/orders/o1/paid").set({ authorization }).expect(409);
    orders[0].paymentStatus = "UNPAID";
  });

  it("refuse un membre désactivé même avec un jeton encore valide", async () => {
    const { authorization } = await login("afi@ama.tg", "caisse-2026");
    staff[0].active = false;
    await request(app).get("/api/restaurant/orders/o1").set({ authorization }).expect(401);
    await request(app).post("/api/restaurant/login").send({ email: "afi@ama.tg", password: "caisse-2026" }).expect(401);
    staff[0].active = true;
  });

  it("la manageuse ajoute une caissière mais ni manageuse ni identité du restaurant", async () => {
    const { authorization } = await login("edem@ama.tg", "manager-2026");
    await request(app).post("/api/restaurant/team").set({ authorization }).send({ name: "Kossi", email: "kossi@ama.tg", password: "caisse-2027", role: "CASHIER" }).expect(201);
    await request(app).post("/api/restaurant/team").set({ authorization }).send({ name: "Yao", email: "yao@ama.tg", password: "manager-2027", role: "MANAGER" }).expect(403);
    await request(app).patch("/api/restaurant/team/s2").set({ authorization }).send({ active: false }).expect(403);
    await request(app).patch("/api/restaurant/team/s1").set({ authorization }).send({ role: "MANAGER" }).expect(403);
    await request(app).post("/api/restaurant/team").set({ authorization }).send({ name: "Faux", email: "gerant@ama.tg", password: "caisse-2027", role: "CASHIER" }).expect(409);
    await request(app).patch("/api/restaurant/settings").set({ authorization }).send({ phone: "+228 91 11 11 11" }).expect(403);
    expect(created).toHaveLength(1);
  });

  it("le gérant garde tous les droits", async () => {
    const { authorization, body } = await login("gerant@ama.tg", "gerant-2026");
    expect(body.role).toBe("OWNER");
    await request(app).post("/api/restaurant/team").set({ authorization }).send({ name: "Yao", email: "yao@ama.tg", password: "manager-2027", role: "MANAGER" }).expect(201);
    const me = await request(app).get("/api/restaurant/me").set({ authorization }).expect(200);
    expect(me.body.account.role).toBe("OWNER");
    expect(me.body.commissionRate).toBe(10);
  });
});
