import express from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { adminCatalogRouter } from "./routes/adminCatalog.js";

// Base simulée : un commerce, sa carte et ses bannières.
function fakeDb(banners = 0) {
  const state = { created: [] as Record<string, unknown>[], banners: [] as Record<string, unknown>[] };
  const prisma = {
    restaurant: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: "new", ...data };
      },
    },
    restaurantBanner: {
      count: async () => banners + state.banners.length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.banners.push(data);
        return { id: "b1", ...data };
      },
    },
    menuItem: { findFirst: async ({ where }: { where: { id: string; restaurantId: string } }) => (where.id === "m1" && where.restaurantId === "r1" ? { id: "m1" } : null) },
    settings: { findFirst: async () => ({ id: 1, vendorSubscriptionFee: 10000 }) },
  } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  app.use(adminCatalogRouter(prisma, { frontendOrigin: "https://zedeka.tg" }));
  return { app, state };
}

const base = { name: "Ama Mode", slug: "ama-mode", phone: "90112233", address: "Bè", latitude: 6.13, longitude: 1.24 };

describe("type de commerce", () => {
  it("un nouveau commerce est un restaurant par défaut", async () => {
    const { app, state } = fakeDb();
    await request(app).post("/restaurants").send(base).expect(201);
    expect(state.created[0]).toMatchObject({ kind: "RESTAURANT", shopCategory: null, reviewNewItems: false });
  });

  it("l'admin crée une boutique avec sa catégorie et la vérification des articles", async () => {
    const { app, state } = fakeDb();
    await request(app).post("/restaurants").send({ ...base, kind: "SHOP", shopCategory: "mode", reviewNewItems: true }).expect(201);
    expect(state.created[0]).toMatchObject({ kind: "SHOP", shopCategory: "mode", reviewNewItems: true });
  });

  it("refuse une catégorie inconnue", async () => {
    const { app } = fakeDb();
    await request(app).post("/restaurants").send({ ...base, kind: "SHOP", shopCategory: "voitures" }).expect(400);
  });
});

describe("bannières d'un commerce", () => {
  it("ajoute une bannière qui mène à un article de la carte", async () => {
    const { app, state } = fakeDb();
    await request(app).post("/restaurants/r1/banners").send({ url: "https://zedeka.tg/img/promo.webp", title: "Soldes", menuItemId: "m1" }).expect(201);
    expect(state.banners[0]).toMatchObject({ restaurantId: "r1", kind: "IMAGE", menuItemId: "m1", position: 0 });
  });

  it("refuse un article d'un autre commerce", async () => {
    const { app } = fakeDb();
    const res = await request(app).post("/restaurants/r1/banners").send({ url: "https://zedeka.tg/img/promo.webp", menuItemId: "autre" }).expect(400);
    expect(res.body.error).toMatch(/carte/);
  });

  it("8 bannières au maximum", async () => {
    const { app } = fakeDb(8);
    await request(app).post("/restaurants/r1/banners").send({ url: "https://zedeka.tg/img/promo.webp" }).expect(400);
  });
});
