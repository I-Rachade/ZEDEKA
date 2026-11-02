import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

type Row = Record<string, unknown> & { id: string };
const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

// Base en mémoire : restaurants, commandes, dépôts et ce que la suppression efface.
function setup() {
  const restaurants: Row[] = [
    { id: "neuf", slug: "neuf", name: "Nouveau", active: true, deletedAt: null, ownerEmail: null },
    { id: "ancien", slug: "chez-afi", name: "Chez Afi", active: true, deletedAt: null, ownerEmail: "afi@resto.tg", ownerPasswordHash: "x" },
    { id: "occupe", slug: "occupe", name: "Occupé", active: true, deletedAt: null },
    { id: "depot", slug: "depot", name: "Dépôt", active: true, deletedAt: null },
  ];
  const orders: Row[] = [
    { id: "o1", restaurantId: "ancien", status: "DELIVERED", subtotal: 3000, commission: 0, type: "FOOD", paidFromDeposit: false },
    { id: "o2", restaurantId: "occupe", status: "PREPARING" },
  ];
  const deposits: Row[] = [{ id: "d1", restaurantId: "depot", amount: 25000 }];
  const menuItems: Row[] = [
    { id: "m1", restaurantId: "neuf", available: true },
    { id: "m2", restaurantId: "ancien", available: true },
  ];
  const addons: Row[] = [{ id: "a1", restaurantId: "neuf" }];
  const staff: Row[] = [{ id: "s1", restaurantId: "ancien" }];
  const tables: Row[] = [{ id: "t1", restaurantId: "ancien" }];
  const pushes: Row[] = [
    { id: "p1", role: "restaurant", subject: "ancien" },
    { id: "p2", role: "restaurant", subject: "neuf" },
    { id: "p3", role: "restaurant", subject: "occupe" },
  ];
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "in" in v ? (v as { in: unknown[] }).in.includes(row[k]) : row[k] === v,
    );
  const removeWhere = (rows: Row[]) => async ({ where }: { where: Record<string, unknown> }) => {
    for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
    return { count: 0 };
  };
  const prisma = {
    teamMember: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        where.email === "koffi@zedeka.tg" || where.id === "m1"
          ? { id: "m1", name: "Koffi", email: "koffi@zedeka.tg", passwordHash: bcrypt.hashSync("dispatch-2026", 4), role: "DISPATCHER", active: true }
          : null,
      update: async () => ({}),
    },
    restaurant: {
      findUnique: async ({ where }: { where: { id: string } }) => restaurants.find((r) => r.id === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => restaurants.splice(restaurants.findIndex((r) => r.id === where.id), 1)[0],
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(restaurants.find((r) => r.id === where.id)!, data),
    },
    order: {
      count: async ({ where }: { where: Record<string, unknown> }) => orders.filter((o) => matches(o, where)).length,
      findMany: async ({ where }: { where: Record<string, unknown> }) => orders.filter((o) => matches(o, where)),
    },
    restaurantSettlement: { count: async () => 0 },
    restaurantDeposit: { findMany: async ({ where }: { where: Record<string, unknown> }) => deposits.filter((d) => matches(d, where)) },
    menuItem: {
      deleteMany: removeWhere(menuItems),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        menuItems.filter((m) => matches(m, where)).forEach((m) => Object.assign(m, data));
        return { count: 0 };
      },
    },
    addon: { deleteMany: removeWhere(addons) },
    restaurantStaff: { deleteMany: removeWhere(staff) },
    restaurantTable: { deleteMany: removeWhere(tables) },
    locationRequest: { updateMany: async () => ({ count: 0 }) },
    pushSubscription: { deleteMany: removeWhere(pushes) },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });
  return { app, restaurants, menuItems, addons, staff, tables, pushes };
}

async function director(app: ReturnType<typeof setup>["app"]) {
  const res = await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
  return { authorization: `Bearer ${res.body.token}` };
}

describe("suppression d'un restaurant", () => {
  it("efface un restaurant sans aucune commande, avec sa carte", async () => {
    const { app, restaurants, menuItems, addons, pushes } = setup();
    const res = await request(app).delete("/api/admin/restaurants/neuf").set(await director(app)).expect(200);
    expect(res.body).toEqual({ deleted: true, kept: false });
    expect(restaurants.find((r) => r.id === "neuf")).toBeUndefined();
    expect(menuItems.map((m) => m.id)).toEqual(["m2"]);
    expect(addons).toHaveLength(0);
    expect(pushes.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("garde le nom d'un restaurant qui a des commandes passées mais le ferme et efface ses accès", async () => {
    const { app, restaurants, menuItems, staff, tables, pushes } = setup();
    const res = await request(app).delete("/api/admin/restaurants/ancien").set(await director(app)).expect(200);
    expect(res.body).toEqual({ deleted: true, kept: true });
    const r = restaurants.find((x) => x.id === "ancien")!;
    expect(r.name).toBe("Chez Afi");
    expect(r.deletedAt).toBeInstanceOf(Date);
    expect(r).toMatchObject({ active: false, slug: "supprime-ancien", ownerEmail: null, ownerPasswordHash: null });
    expect(r.sessionsValidFrom).toBeInstanceOf(Date);
    expect(menuItems.find((m) => m.id === "m2")!.available).toBe(false);
    expect(staff).toHaveLength(0);
    expect(tables).toHaveLength(0);
    // Plus de notifications sur les appareils du gérant et de l'équipe.
    expect(pushes.map((p) => p.id)).toEqual(["p2", "p3"]);
    // Déjà supprimé : introuvable.
    await request(app).delete("/api/admin/restaurants/ancien").set(await director(app)).expect(404);
  });

  it("refuse tant qu'une commande est en cours ou qu'il reste de l'argent du dépôt", async () => {
    const { app, restaurants, pushes } = setup();
    const auth = await director(app);
    const busy = await request(app).delete("/api/admin/restaurants/occupe").set(auth).expect(409);
    expect(busy.body.error).toMatch(/commande en cours/);
    const deposit = await request(app).delete("/api/admin/restaurants/depot").set(auth).expect(409);
    expect(deposit.body.error).toMatch(/dépôt/);
    expect(restaurants).toHaveLength(4);
    expect(pushes).toHaveLength(3);
  });

  it("est fermée au dispatcheur", async () => {
    const { app, restaurants } = setup();
    const login = await request(app).post("/api/admin/login").send({ email: "koffi@zedeka.tg", password: "dispatch-2026" }).expect(200);
    await request(app).delete("/api/admin/restaurants/neuf").set({ authorization: `Bearer ${login.body.token}` }).expect(403);
    expect(restaurants).toHaveLength(4);
  });
});
