import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { CUSTOMER_TOKEN_TTL_MS, issueToken } from "./auth.js";

// Caisse d'un repas livré : Zedeka+ (remise d'office sur la livraison) et livraison offerte payée en points.
const SECRET = "s".repeat(64);
const zone = { id: "z-be", name: "Bè", latitude: 6.13, longitude: 1.24, active: true, deliveryFee: 1000 };
const restaurant = {
  id: "r1",
  slug: "chez-ama",
  name: "Chez Ama",
  active: true,
  zoneId: "z-be",
  latitude: 6.1319,
  longitude: 1.2386,
  commissionRate: 0,
  minOrderAmount: 0,
  temporarilyClosed: false,
  closedUntil: null,
  openingHours: [],
};

function db({ plusUntil = null as Date | null, spent = 0, redeemed = 0, referral = 0 } = {}) {
  const orders: Record<string, unknown>[] = [];
  const prisma = {
    settings: {
      findFirst: async () => ({
        id: 1,
        foodMinFee: 500,
        foodPerKmFee: 150,
        foodMaxFee: 0,
        mobileMoneyEnabled: false,
        plusEnabled: true,
        plusMonthlyFee: 2500,
        plusDeliveryDiscount: 100,
        plusMinSubtotal: 3000,
        loyaltySpendPerPoint: 100,
        loyaltyRewardPoints: 300,
      }),
    },
    customer: {
      findUnique: async () => ({ deletedAt: null, sessionsValidFrom: null, plusUntil }),
      count: async () => referral,
    },
    restaurant: { findFirst: async () => restaurant, findMany: async () => [] },
    zone: { findMany: async () => [zone], findUnique: async () => zone, findFirst: async () => zone },
    menuItem: { findMany: async () => [{ id: "m1", name: "Riz sauce", price: 2000, variants: [], addons: [] }] },
    order: {
      count: async () => 0,
      aggregate: async ({ _sum }: { _sum: Record<string, true> }) => ({ _sum: _sum.total ? { total: spent } : { loyaltyRedeemed: redeemed } }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const o = { id: `o${orders.length + 1}`, code: "ZD-1", ...data };
        orders.push(o);
        return o;
      },
    },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: SECRET });
  return { app, orders };
}

const auth = { authorization: `Bearer ${issueToken(SECRET, Date.now(), "customer", "c1", CUSTOMER_TOKEN_TTL_MS)}` };
const order = { acceptTerms: true, restaurantSlug: "chez-ama", customerName: "Koffi Mensah", customerPhone: "90112233", paymentMethod: "CASH", latitude: 6.1475, longitude: 1.2125 };
const items = (quantity: number) => [{ menuItemId: "m1", quantity }];
const inAMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

describe("Zedeka+ à la caisse", () => {
  it("abonné : livraison offerte d'office dès le panier minimum", async () => {
    const { app, orders } = db({ plusUntil: inAMonth });
    const res = await request(app).post("/api/orders").set(auth).send({ ...order, items: items(2) }).expect(201);
    expect(orders[0]).toMatchObject({ plusApplied: true, promoCode: "ZEDEKA+", promoPayer: "ZEDEKA", deliveryFee: 550, discount: 550 });
    expect(res.body.total).toBe(4000);
  });

  it("panier sous le minimum : prix normal", async () => {
    const { app, orders } = db({ plusUntil: inAMonth });
    await request(app).post("/api/orders").set(auth).send({ ...order, items: items(1) }).expect(201);
    expect(orders[0]).toMatchObject({ plusApplied: false, discount: 0 });
  });

  it("abonnement terminé : prix normal", async () => {
    const { app, orders } = db({ plusUntil: new Date(Date.now() - 1000) });
    await request(app).post("/api/orders").set(auth).send({ ...order, items: items(2) }).expect(201);
    expect(orders[0]).toMatchObject({ plusApplied: false, discount: 0 });
  });
});

describe("livraison offerte payée en points", () => {
  it("sans parrainage, 300 points dépensés", async () => {
    const { app, orders } = db({ spent: 40_000 });
    await request(app).post("/api/orders").set(auth).send({ ...order, items: items(1), useFreeDelivery: true }).expect(201);
    expect(orders[0]).toMatchObject({ referralCredit: false, loyaltyRedeemed: 300, promoCode: "FIDELITE", discount: 550 });
  });

  it("pas assez de points : refusé", async () => {
    const { app, orders } = db({ spent: 40_000, redeemed: 300 });
    const res = await request(app).post("/api/orders").set(auth).send({ ...order, items: items(1), useFreeDelivery: true }).expect(400);
    expect(res.body.error).toContain("pas de livraison offerte");
    expect(orders).toHaveLength(0);
  });
});
