import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// Espace commerce : connexion du gérant par numéro et code PIN, choix du PIN, bannières de la boutique.
type Row = { id: string; name: string; phone: string; kind: string; ownerEmail: string; ownerPasswordHash: string; pinHash: string | null; pinAttempts: number; pinLockedUntil: Date | null; sessionsValidFrom: Date | null };
type Banner = { id: string; restaurantId: string; url: string; position: number; menuItemId: string | null };

function setup() {
  const shop: Row = { id: "r1", name: "Mode Ama", phone: "90 00 00 01", kind: "SHOP", ownerEmail: "ama@mode.tg", ownerPasswordHash: bcrypt.hashSync("motdepasse-2026", 4), pinHash: bcrypt.hashSync("4826", 4), pinAttempts: 0, pinLockedUntil: null, sessionsValidFrom: null };
  const other: Row = { ...shop, id: "r2", name: "Autre", phone: "+228 91 00 00 02", ownerEmail: "autre@x.tg", pinHash: bcrypt.hashSync("5937", 4) };
  const rows = [shop, other];
  const banners: Banner[] = [{ id: "b2", restaurantId: "r2", url: "https://x/2.jpg", position: 0, menuItemId: null }];
  const pick = (r: Row, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k as keyof Row]])) : { ...r });
  const prisma = {
    restaurant: {
      findMany: async ({ where, select }: { where: { phone: { contains: string } }; select: Record<string, boolean> }) =>
        rows.filter((r) => r.pinHash && r.phone.replace(/\D/g, "").includes(where.phone.contains)).map((r) => pick(r, select)),
      findUnique: async ({ where, select }: { where: { id?: string; ownerEmail?: string }; select?: Record<string, boolean> }) => {
        const r = rows.find((x) => x.id === where.id || x.ownerEmail === where.ownerEmail);
        return r ? pick(r, select) : null;
      },
      findUniqueOrThrow: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => pick(rows.find((x) => x.id === where.id)!, select),
      update: async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in v) (r as Record<string, unknown>)[k] = (r[k as keyof Row] as number) + (v as { increment: number }).increment;
          else (r as Record<string, unknown>)[k] = v;
        }
        return pick(r, select);
      },
      updateMany: async () => ({ count: 1 }),
    },
    restaurantStaff: { findUnique: async () => null },
    menuItem: { findFirst: async ({ where }: { where: { id: string; restaurantId: string } }) => (where.id === "m1" && where.restaurantId === "r1" ? { id: "m1" } : null) },
    restaurantBanner: {
      findMany: async ({ where }: { where: { restaurantId: string } }) => banners.filter((b) => b.restaurantId === where.restaurantId),
      count: async ({ where }: { where: { restaurantId: string } }) => banners.filter((b) => b.restaurantId === where.restaurantId).length,
      create: async ({ data }: { data: Omit<Banner, "id"> }) => {
        const b = { id: `b${banners.length + 10}`, ...data };
        banners.push(b);
        return b;
      },
      findFirst: async ({ where }: { where: { id: string; restaurantId: string } }) => banners.find((b) => b.id === where.id && b.restaurantId === where.restaurantId) ?? null,
      deleteMany: async ({ where }: { where: { id: string; restaurantId: string } }) => {
        const i = banners.findIndex((b) => b.id === where.id && b.restaurantId === where.restaurantId);
        if (i >= 0) banners.splice(i, 1);
        return { count: i >= 0 ? 1 : 0 };
      },
    },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) });
  return { app, shop, banners };
}

describe("connexion du gérant par numéro et code PIN", () => {
  it("le bon PIN avec le numéro du commerce, même écrit autrement, ouvre l'espace", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/restaurant/pin/login").send({ phone: "+228 90000001", pin: "4826" }).expect(200);
    expect(res.body).toMatchObject({ name: "Mode Ama", role: "OWNER" });
    expect(res.body.token).toBeTruthy();
  });

  it("PIN faux ou numéro inconnu : même réponse ; 5 essais faux bloquent 15 min", async () => {
    const { app, shop } = setup();
    const unknown = await request(app).post("/api/restaurant/pin/login").send({ phone: "99 99 99 99", pin: "4826" }).expect(401);
    const wrong = await request(app).post("/api/restaurant/pin/login").send({ phone: "90000001", pin: "1111" }).expect(401);
    expect(wrong.body.error).toBe(unknown.body.error);
    for (let i = 0; i < 4; i++) await request(app).post("/api/restaurant/pin/login").send({ phone: "90000001", pin: "1111" });
    expect(shop.pinLockedUntil).toBeInstanceOf(Date);
    await request(app).post("/api/restaurant/pin/login").send({ phone: "90000001", pin: "4826" }).expect(429);
  });

  it("le gérant choisit un nouveau PIN avec son mot de passe ; /me dit qu'il en a un sans le montrer", async () => {
    const { app, shop } = setup();
    const { body } = await request(app).post("/api/restaurant/pin/login").send({ phone: "90000001", pin: "4826" }).expect(200);
    const auth = { Authorization: `Bearer ${body.token}` };
    await request(app).put("/api/restaurant/pin").set(auth).send({ pin: "1234", current: "motdepasse-2026" }).expect(400);
    await request(app).put("/api/restaurant/pin").set(auth).send({ pin: "7391", current: "mauvais" }).expect(400);
    await request(app).put("/api/restaurant/pin").set(auth).send({ pin: "7391", current: "motdepasse-2026" }).expect(200);
    expect(await bcrypt.compare("7391", shop.pinHash!)).toBe(true);
  });
});

describe("bannières dans l'espace commerce", () => {
  it("le commerce gère ses bannières, jamais celles d'un autre, et ne lie que ses articles", async () => {
    const { app, banners } = setup();
    const { body } = await request(app).post("/api/restaurant/pin/login").send({ phone: "90000001", pin: "4826" }).expect(200);
    const auth = { Authorization: `Bearer ${body.token}` };
    expect((await request(app).get("/api/restaurant/banners").set(auth).expect(200)).body).toEqual([]);
    await request(app).post("/api/restaurant/banners").set(auth).send({ url: "https://x/1.jpg", menuItemId: "autre" }).expect(400);
    await request(app).post("/api/restaurant/banners").set(auth).send({ url: "https://x/1.jpg", menuItemId: "m1" }).expect(201);
    await request(app).delete("/api/restaurant/banners/b2").set(auth).expect(404);
    expect(banners.map((b) => b.restaurantId).sort()).toEqual(["r1", "r2"]);
  });
});
