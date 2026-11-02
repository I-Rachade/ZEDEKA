import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { addTables, isTableToken, newTableToken } from "./tables.js";

// Commande sur place depuis le QR code d'une table : sans livreur ni frais, sans commission, numéro de la table gardé.
const restaurant = {
  id: "r1",
  slug: "chez-ama",
  name: "Chez Ama",
  active: true,
  zoneId: "z-be",
  latitude: 6.1319,
  longitude: 1.2386,
  commissionRate: 10,
  minOrderAmount: 0,
  temporarilyClosed: false,
  closedUntil: null,
  openingHours: [],
};
const TOKEN = "AbCdEfGh1234";

function db() {
  const state = { orders: [] as Record<string, unknown>[], tables: [{ id: "t5", restaurantId: "r1", number: 5, token: TOKEN }] as Record<string, unknown>[] };
  const prisma = {
    settings: { upsert: async () => ({ id: 1, foodMinFee: 500, foodPerKmFee: 150, foodMaxFee: 0, mobileMoneyEnabled: false }) },
    restaurant: { findFirst: async () => restaurant, findMany: async () => [] },
    zone: { findMany: async () => [{ id: "z-be", name: "Bè", latitude: 6.13, longitude: 1.24, active: true }] },
    menuItem: { findMany: async () => [{ id: "m1", name: "Riz sauce", price: 2000, variants: [], addons: [] }] },
    restaurantTable: {
      findUnique: async ({ where }: { where: { token: string } }) => {
        const t = state.tables.find((x) => x.token === where.token);
        return t ? { ...t, restaurant: { slug: restaurant.slug, name: restaurant.name, active: true } } : null;
      },
    },
    order: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const o = { id: `o${state.orders.length + 1}`, ...data };
        state.orders.push(o);
        return o;
      },
    },
  } as unknown as PrismaClient;
  return { app: createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" }), state };
}

const order = { acceptTerms: true, restaurantSlug: "chez-ama", customerName: "Koffi", paymentMethod: "CASH", items: [{ menuItemId: "m1", quantity: 2 }] };

describe("commande à table", () => {
  it("le QR code donne le restaurant et le numéro de la table", async () => {
    const { app } = db();
    const res = await request(app).get(`/api/tables/${TOKEN}`).expect(200);
    expect(res.body).toEqual({ number: 5, restaurant: { slug: "chez-ama", name: "Chez Ama" } });
    await request(app).get("/api/tables/inconnu").expect(404);
  });

  it("sur place : sans livraison ni commission, sans numéro de téléphone, table gardée", async () => {
    const { app, state } = db();
    const res = await request(app).post("/api/orders").send({ ...order, tableToken: TOKEN, fulfillment: "DELIVERY" }).expect(201);
    expect(res.body).toMatchObject({ total: 4000, tableNumber: 5 });
    expect(state.orders[0]).toMatchObject({
      fulfillment: "PICKUP",
      tableNumber: 5,
      deliveryFee: 0,
      commission: 0,
      customerPhone: "",
      address: "Sur place, table 5 chez Chez Ama",
    });
  });

  it("refuse un QR code inconnu ou d'un autre restaurant", async () => {
    const { app, state } = db();
    await request(app).post("/api/orders").send({ ...order, tableToken: "ZZZZZZZZZZZZ" }).expect(400);
    await request(app).post("/api/orders").send({ ...order, tableToken: TOKEN, restaurantSlug: "autre" }).expect(400);
    expect(state.orders).toHaveLength(0);
  });

  it("hors table, le numéro de téléphone reste obligatoire", async () => {
    const { app } = db();
    const res = await request(app).post("/api/orders").send({ ...order, fulfillment: "PICKUP" }).expect(400);
    expect(res.body.error).toContain("téléphone");
    await request(app).post("/api/orders").send({ ...order, fulfillment: "PICKUP", customerPhone: "90112233" }).expect(201);
  });
});

describe("tables d'un restaurant", () => {
  it("liens aléatoires de 12 caractères", () => {
    const a = newTableToken();
    expect(isTableToken(a)).toBe(true);
    expect(a).not.toBe(newTableToken());
    expect(isTableToken("../admin")).toBe(false);
  });

  it("numérote les nouvelles tables à la suite, 200 au maximum", async () => {
    const rows: { restaurantId: string; number: number; token: string }[] = [{ restaurantId: "r1", number: 3, token: newTableToken() }];
    const prisma = {
      restaurantTable: {
        findMany: async () => [...rows].sort((a, b) => a.number - b.number),
        create: async ({ data }: { data: (typeof rows)[number] }) => rows.push(data),
      },
    } as unknown as PrismaClient;
    const list = await addTables(prisma, "r1", 3);
    expect(list?.map((t) => t.number)).toEqual([3, 4, 5, 6]);
    expect(await addTables(prisma, "r1", 197)).toBeNull();
  });
});
