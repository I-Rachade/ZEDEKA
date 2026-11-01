import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { locationLink } from "./locationRequest.js";

// Repas livré à un point (position, carte, lien Google Maps, ou position partagée par la personne livrée),
// au km depuis le restaurant : 500 FCFA minimum, 150 FCFA/km (un peu moins cher que les colis).
const zoneList = [
  { id: "z-adidogome", name: "Adidogomé", latitude: 6.15, longitude: 1.2, active: true, deliveryFee: 1500 },
  { id: "z-be", name: "Bè", latitude: 6.13, longitude: 1.24, active: true, deliveryFee: 1000 },
];
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

function db() {
  const state = { orders: [] as Record<string, unknown>[], requests: [] as Record<string, unknown>[] };
  const match = (r: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (k === "expiresAt" ? (r.expiresAt as Date) > (v as { gt: Date }).gt : r[k] === v));
  const prisma = {
    settings: { upsert: async () => ({ id: 1, foodMinFee: 500, foodPerKmFee: 150, foodMaxFee: 0, mobileMoneyEnabled: false }) },
    restaurant: { findFirst: async () => restaurant, findMany: async () => [] },
    zone: {
      findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => (where.id?.in ? zoneList.filter((z) => where.id!.in!.includes(z.id)) : zoneList),
    },
    menuItem: { findMany: async () => [{ id: "m1", name: "Riz sauce", price: 2000, variants: [], addons: [] }] },
    locationRequest: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `lr${state.requests.length + 1}`, status: "PENDING", orderId: null, order: null, latitude: null, longitude: null, landmark: null, ...data };
        state.requests.push(r);
        return r;
      },
      findUnique: async ({ where }: { where: Record<string, unknown> }) => state.requests.find((r) => match(r, where)) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => state.requests.find((r) => match(r, where)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(state.requests.find((x) => x.id === where.id)!, data),
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

const order = { restaurantSlug: "chez-ama", customerName: "Koffi Mensah", customerPhone: "90112233", paymentMethod: "CASH", items: [{ menuItemId: "m1", quantity: 1 }] };

describe("adresse de livraison des repas", () => {
  it("prend le point de livraison, en déduit la zone et le prix au km depuis le restaurant", async () => {
    const { app, state } = db();
    const res = await request(app).post("/api/orders").send({ ...order, latitude: 6.1475, longitude: 1.2125 }).expect(201);
    // 3,4 km × 150 = 510, arrondi à 550.
    expect(res.body.total).toBe(2550);
    expect(state.orders[0]).toMatchObject({ zoneId: "z-adidogome", distanceKm: 3.4, deliveryFee: 550, locationSource: "SENDER", address: "Position sur la carte" });
  });

  it("garde le repère écrit, facultatif", async () => {
    const { app, state } = db();
    await request(app).post("/api/orders").send({ ...order, latitude: 6.1475, longitude: 1.2125, address: "portail vert" }).expect(201);
    expect(state.orders[0]).toMatchObject({ address: "portail vert" });
  });

  it("refuse une livraison sans point de livraison", async () => {
    const { app } = db();
    const res = await request(app).post("/api/orders").send({ ...order, address: "Tokoin" }).expect(400);
    expect(res.body.error).toContain("point de livraison");
  });

  it("accepte encore zone et adresse écrite des anciens écrans, au prix de la zone", async () => {
    const { app, state } = db();
    await request(app).post("/api/orders").send({ ...order, zoneId: "z-adidogome", address: "Adidogomé, près du rond-point" }).expect(201);
    expect(state.orders[0]).toMatchObject({ zoneId: "z-adidogome", deliveryFee: 1500, latitude: null });
  });

  it("à emporter : ni point ni frais, zone du restaurant", async () => {
    const { app, state } = db();
    await request(app).post("/api/orders").send({ ...order, fulfillment: "PICKUP" }).expect(201);
    expect(state.orders[0]).toMatchObject({ zoneId: "z-be", deliveryFee: 0, address: "À emporter chez Chez Ama" });
  });

  it("pour quelqu'un d'autre : lien de repas, position partagée, puis commande", async () => {
    const { app, state } = db();
    const { body } = await request(app).post("/api/location-requests").send({ senderName: "Koffi Mensah", recipientName: "Ama", kind: "FOOD" }).expect(201);
    expect(body.text).toContain("Koffi vous fait livrer un repas");
    const token = body.url.split("/").pop();
    expect((await request(app).get(`/api/position/${token}`).expect(200)).body.kind).toBe("FOOD");

    // Pas encore de réponse : le repas n'attend pas, la commande est refusée.
    const early = await request(app).post("/api/orders").send({ ...order, locationRequestKey: body.pollKey }).expect(400);
    expect(early.body.error).toContain("pas encore été partagée");

    await request(app).post(`/api/position/${token}`).send({ latitude: 6.1475, longitude: 1.2125, landmark: "portail vert", consent: true }).expect(200);
    await request(app).post("/api/orders").send({ ...order, locationRequestKey: body.pollKey }).expect(201);
    expect(state.orders[0]).toMatchObject({ latitude: 6.1475, longitude: 1.2125, locationSource: "RECIPIENT", deliveryFee: 550, address: "Repère : portail vert" });
    expect(state.requests[0]).toMatchObject({ orderId: "o1", kind: "FOOD" });
  });

  it("refuse une clé de demande inconnue", async () => {
    const { app } = db();
    await request(app).post("/api/orders").send({ ...order, locationRequestKey: "x".repeat(22) }).expect(400);
  });
});

describe("message du lien", () => {
  it("parle d'un repas ou d'un colis", () => {
    const later = new Date(Date.now() + 3600_000);
    expect(locationLink("https://z.tg", "T".repeat(22), { customerName: "Koffi", recipientName: null, kind: "FOOD" }, later).text).toContain("vous fait livrer un repas");
    expect(locationLink("https://z.tg", "T".repeat(22), { customerName: "Koffi", recipientName: null }, later).text).toContain("vous envoie un colis");
  });
});

describe("recherche de lieu sur la carte", () => {
  it("lit un lien Google Maps sans appeler la recherche", async () => {
    const { searchPlaces } = await import("./places.js");
    const fetcher = async () => {
      throw new Error("pas d'appel");
    };
    expect(await searchPlaces("https://www.google.com/maps/@6.1475,1.2125,17z", fetcher)).toMatchObject([{ latitude: 6.1475, longitude: 1.2125 }]);
  });
  it("cherche un nom au Togo et garde nom et quartier", async () => {
    const { searchPlaces } = await import("./places.js");
    let called = "";
    const fetcher = async (url: string) => {
      called = url;
      return new Response(JSON.stringify([{ lat: "6.17", lon: "1.21", name: "Marché d'Agoè", display_name: "Marché d'Agoè, Agoè, Lomé, Golfe, Togo" }]));
    };
    const r = await searchPlaces("marché agoè", fetcher);
    expect(called).toContain("nominatim.openstreetmap.org");
    expect(called).toContain("countrycodes=tg");
    expect(r).toEqual([{ latitude: 6.17, longitude: 1.21, name: "Marché d'Agoè", detail: "Agoè, Lomé, Golfe" }]);
  });
});
