import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// L'admin crée et gère les tables d'un restaurant (QR codes de commande sur place), comme le gérant.
type Row = { id: string; restaurantId: string; number: number; token: string };
const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

function setup() {
  const restaurants = [
    { id: "r1", deletedAt: null },
    { id: "parti", deletedAt: new Date() },
  ];
  const tables: Row[] = [{ id: "t-autre", restaurantId: "r2", number: 1, token: "AbCdEfGh1234" }];
  let next = 0;
  const of = (where: { restaurantId?: string; id?: string }) => tables.filter((t) => (!where.restaurantId || t.restaurantId === where.restaurantId) && (!where.id || t.id === where.id));
  const prisma = {
    teamMember: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        where.email === "koffi@zedeka.tg" || where.id === "m1"
          ? { id: "m1", name: "Koffi", email: "koffi@zedeka.tg", passwordHash: bcrypt.hashSync("dispatch-2026", 4), role: "DISPATCHER", active: true }
          : null,
      update: async () => ({}),
    },
    restaurant: { findUnique: async ({ where }: { where: { id: string } }) => restaurants.find((r) => r.id === where.id) ?? null },
    restaurantTable: {
      findMany: async ({ where }: { where: { restaurantId: string } }) => of(where).sort((a, b) => a.number - b.number),
      findFirst: async ({ where }: { where: { restaurantId: string; id: string } }) => of(where)[0] ?? null,
      create: async ({ data }: { data: Omit<Row, "id"> }) => tables.push({ id: `t${++next}`, ...data }),
      update: async ({ where, data }: { where: { id: string }; data: { token: string } }) => Object.assign(tables.find((t) => t.id === where.id)!, data),
      deleteMany: async ({ where }: { where: { restaurantId: string; id: string } }) => {
        const found = of(where);
        found.forEach((t) => tables.splice(tables.indexOf(t), 1));
        return { count: found.length };
      },
    },
  } as unknown as PrismaClient;
  return { app: createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG }), tables };
}

async function login(app: ReturnType<typeof setup>["app"], body: Record<string, string>) {
  const res = await request(app).post("/api/admin/login").send(body).expect(200);
  return { authorization: `Bearer ${res.body.token}` };
}

describe("tables d'un restaurant depuis l'admin", () => {
  it("crée des tables numérotées à la suite, renouvelle un QR code et supprime une table", async () => {
    const { app, tables } = setup();
    const auth = await login(app, { password: STRONG.adminPassword });
    const created = await request(app).post("/api/admin/restaurants/r1/tables").set(auth).send({ count: 3 }).expect(201);
    expect(created.body.map((t: Row) => t.number)).toEqual([1, 2, 3]);
    const more = await request(app).post("/api/admin/restaurants/r1/tables").set(auth).send({ count: 2 }).expect(201);
    expect(more.body.map((t: Row) => t.number)).toEqual([1, 2, 3, 4, 5]);

    const before = tables.find((t) => t.id === "t1")!.token;
    await request(app).post("/api/admin/restaurants/r1/tables/t1/renew").set(auth).expect(200);
    expect(tables.find((t) => t.id === "t1")!.token).not.toBe(before);

    const left = await request(app).delete("/api/admin/restaurants/r1/tables/t2").set(auth).expect(200);
    expect(left.body.map((t: Row) => t.number)).toEqual([1, 3, 4, 5]);
    const list = await request(app).get("/api/admin/restaurants/r1/tables").set(auth).expect(200);
    expect(list.body).toHaveLength(4);
  });

  it("ne touche pas aux tables d'un autre restaurant ni d'un restaurant supprimé", async () => {
    const { app, tables } = setup();
    const auth = await login(app, { password: STRONG.adminPassword });
    await request(app).delete("/api/admin/restaurants/r1/tables/t-autre").set(auth).expect(404);
    await request(app).post("/api/admin/restaurants/r1/tables/t-autre/renew").set(auth).expect(404);
    expect(tables.find((t) => t.id === "t-autre")!.token).toBe("AbCdEfGh1234");
    await request(app).post("/api/admin/restaurants/parti/tables").set(auth).send({ count: 1 }).expect(404);
    await request(app).post("/api/admin/restaurants/inconnu/tables").set(auth).send({ count: 1 }).expect(404);
    await request(app).post("/api/admin/restaurants/r1/tables").set(auth).send({ count: 0 }).expect(400);
  });

  it("le dispatcheur ne gère pas les tables", async () => {
    const { app } = setup();
    const auth = await login(app, { email: "koffi@zedeka.tg", password: "dispatch-2026" });
    await request(app).get("/api/admin/restaurants/r1/tables").set(auth).expect(403);
    await request(app).post("/api/admin/restaurants/r1/tables").set(auth).send({ count: 1 }).expect(403);
  });
});
