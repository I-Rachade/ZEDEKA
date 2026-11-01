import express from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashLocationToken, newLocationToken, restaurantLocationLink, restaurantLocationState } from "./locationRequest.js";
import { adminCatalogRouter } from "./routes/adminCatalog.js";

const now = new Date("2026-11-01T12:00:00Z");
const later = new Date("2026-11-05T12:00:00Z");
const earlier = new Date("2026-10-30T12:00:00Z");

describe("état de la position d'un restaurant", () => {
  it("placée, demandée, échue ou manquante", () => {
    expect(restaurantLocationState({ latitude: 6.13, longitude: 1.22 }, now)).toBe("SET");
    expect(restaurantLocationState({ latitude: null, longitude: null }, now)).toBe("MISSING");
    expect(restaurantLocationState({ latitude: null, longitude: null, locationRequest: { status: "OPENED", expiresAt: later } }, now)).toBe("REQUESTED");
    expect(restaurantLocationState({ latitude: null, longitude: null, locationRequest: { status: "PENDING", expiresAt: earlier } }, now)).toBe("EXPIRED");
    expect(restaurantLocationState({ latitude: null, longitude: null, locationRequest: { status: "EXPIRED", expiresAt: later } }, now)).toBe("EXPIRED");
  });

  it("le message part sur WhatsApp au numéro du restaurant", () => {
    const l = restaurantLocationLink("https://zedeka.tg/", "T".repeat(22), { name: "Chez Ama", phone: "90 11 22 33" }, later);
    expect(l.url).toBe(`https://zedeka.tg/position/${"T".repeat(22)}`);
    expect(l.whatsappUrl.startsWith("https://wa.me/22890112233?text=")).toBe(true);
    expect(l.text).toContain("Chez Ama");
  });
});

// Base simulée : les restaurants et les demandes de position.
function fakeDb(start: { active: boolean; latitude: number | null; longitude: number | null } = { active: true, latitude: null, longitude: null }) {
  const state = {
    restaurant: { id: "r1", name: "Chez Ama", phone: "90112233", address: "Bè", ...start },
    created: [] as Record<string, unknown>[],
    upserts: [] as Record<string, unknown>[],
    revoked: 0,
  };
  const prisma = {
    restaurant: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: "new", ...data };
      },
      findUnique: async () => state.restaurant,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.restaurant, data),
    },
    locationRequest: {
      upsert: async (args: Record<string, unknown>) => {
        state.upserts.push(args);
        return {};
      },
      updateMany: async () => {
        state.revoked++;
        return { count: 1 };
      },
    },
    settings: { upsert: async () => ({ id: 1, vendorSubscriptionFee: 10000 }) },
  } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  app.use(adminCatalogRouter(prisma, { frontendOrigin: "https://zedeka.tg" }));
  return { app, state };
}

const base = { name: "Chez Ama", slug: "chez-ama", phone: "90112233", address: "Bè" };

describe("création d'un restaurant dans l'admin", () => {
  it("refuse un restaurant sans position", async () => {
    const { app, state } = fakeDb();
    const res = await request(app).post("/restaurants").send(base).expect(400);
    expect(res.body.error).toMatch(/carte/);
    expect(state.created).toHaveLength(0);
  });

  it("accepte un restaurant placé sur la carte, visible tout de suite", async () => {
    const { app, state } = fakeDb();
    await request(app).post("/restaurants").send({ ...base, latitude: 6.13, longitude: 1.24 }).expect(201);
    expect(state.created[0]).toMatchObject({ latitude: 6.13, longitude: 1.24, active: true });
    expect(state.upserts).toHaveLength(0);
  });

  it("avec une demande au gérant : masqué, et un lien à envoyer", async () => {
    const { app, state } = fakeDb();
    const res = await request(app).post("/restaurants").send({ ...base, requestLocation: true }).expect(201);
    expect(state.created[0]).toMatchObject({ latitude: null, longitude: null, active: false });
    expect(state.created[0]).not.toHaveProperty("requestLocation");
    expect(res.body.locationLink.url).toMatch(/^https:\/\/zedeka\.tg\/position\/[A-Za-z0-9_-]{22}$/);
    expect(state.upserts[0]).toMatchObject({ where: { restaurantId: "new" }, create: { kind: "RESTAURANT", status: "PENDING" } });
  });
});

describe("modification d'un restaurant", () => {
  it("ne rend pas visible un restaurant sans position", async () => {
    const { app } = fakeDb({ active: false, latitude: null, longitude: null });
    const res = await request(app).patch("/restaurants/r1").send({ active: true }).expect(400);
    expect(res.body.error).toMatch(/position/);
  });

  it("laisse visible un ancien restaurant sans position, mais n'efface pas une position", async () => {
    await request(fakeDb({ active: true, latitude: null, longitude: null }).app).patch("/restaurants/r1").send({ name: "Chez Ama 2", active: true }).expect(200);
    await request(fakeDb({ active: true, latitude: 6.1, longitude: 1.2 }).app).patch("/restaurants/r1").send({ latitude: null, longitude: null }).expect(400);
  });

  it("une position placée par l'admin rend caduc le lien envoyé", async () => {
    const { app, state } = fakeDb({ active: false, latitude: null, longitude: null });
    await request(app).patch("/restaurants/r1").send({ latitude: 6.13, longitude: 1.24, active: true }).expect(200);
    expect(state.restaurant).toMatchObject({ latitude: 6.13, active: true });
    expect(state.revoked).toBe(1);
  });

  it("donne un nouveau lien à la demande", async () => {
    const { app, state } = fakeDb();
    const res = await request(app).post("/restaurants/r1/location-link").expect(201);
    expect(res.body.whatsappUrl).toContain("wa.me/22890112233");
    expect(state.upserts).toHaveLength(1);
  });
});

describe("page du gérant", () => {
  function linkDb(status = "OPENED") {
    const token = newLocationToken();
    const state = { restaurantUpdates: [] as Record<string, unknown>[], requestUpdates: [] as Record<string, unknown>[] };
    const req = { id: "lr1", tokenHash: hashLocationToken(token), status, kind: "RESTAURANT", expiresAt: new Date(Date.now() + 3600_000), restaurantId: "r1", order: null, restaurant: { id: "r1", name: "Chez Ama", address: "Bè" } };
    const prisma = {
      locationRequest: {
        findUnique: async ({ where }: { where: { tokenHash: string } }) => (where.tokenHash === req.tokenHash ? req : null),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          state.requestUpdates.push(data);
          return data;
        },
      },
      restaurant: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          state.restaurantUpdates.push(data);
          return data;
        },
      },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    } as unknown as PrismaClient;
    return { app: createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" }), token, state };
  }

  it("montre le nom du restaurant", async () => {
    const { app, token } = linkDb();
    const res = await request(app).get(`/api/position/${token}`).expect(200);
    expect(res.body).toMatchObject({ kind: "RESTAURANT", restaurantName: "Chez Ama", status: "OPENED" });
  });

  it("enregistre la position sur le restaurant, avec le repère", async () => {
    const { app, token, state } = linkDb();
    await request(app).post(`/api/position/${token}`).send({ latitude: 6.13, longitude: 1.24, landmark: "face à la pharmacie", consent: true }).expect(200);
    expect(state.restaurantUpdates[0]).toEqual({ latitude: 6.13, longitude: 1.24, address: "Bè · Repère : face à la pharmacie" });
    expect(state.requestUpdates[0]).toMatchObject({ status: "SHARED" });
  });

  it("ne permet pas de refuser", async () => {
    const { app, token, state } = linkDb();
    await request(app).post(`/api/position/${token}/decline`).send({}).expect(400);
    expect(state.requestUpdates).toHaveLength(0);
  });
});
