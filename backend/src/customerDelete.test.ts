import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

type Row = Record<string, unknown> & { id: string };

// Base en mémoire : comptes clients, codes SMS, commandes, adresses et abonnements aux notifications.
function setup() {
  const customers: Row[] = [];
  const codes: Row[] = [];
  const orders: Row[] = [];
  const addresses: Row[] = [];
  const pushes: Row[] = [];
  let n = 0;
  const match = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "contains" in v ? String(row[k]).includes(String(v.contains)) : v && typeof v === "object" && "in" in v ? (v.in as unknown[]).includes(row[k]) : row[k] === v));
  const apply = (row: Row, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? (row[k] as number) + (v.increment as number) : v;
    return row;
  };
  const removeWhere = (rows: Row[]) => async ({ where }: { where: Record<string, unknown> }) => {
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1), count++;
    return { count };
  };
  const prisma = {
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    customer: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => customers.find((c) => match(c, where)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => customers.find((c) => match(c, where))!,
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => apply(customers.find((c) => match(c, where))!, data),
      upsert: async ({ where, update, create }: { where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const found = customers.find((c) => match(c, where));
        if (found) return apply(found, update);
        const row = { id: `c${++n}`, name: null, email: null, pinHash: null, pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null, deletedAt: null, sessionsValidFrom: null, ...create };
        customers.push(row);
        return row;
      },
    },
    otpCode: {
      findMany: async ({ where }: { where: { phone: string } }) => codes.filter((c) => c.phone === where.phone),
      create: async ({ data }: { data: Record<string, unknown> }) => codes.push({ id: `o${++n}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data }),
      findFirst: async ({ where }: { where: { phone: string } }) => [...codes].reverse().find((c) => c.phone === where.phone && !c.consumedAt) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => apply(codes.find((c) => c.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: { phone: string }; data: Record<string, unknown> }) => {
        codes.filter((c) => c.phone === where.phone && !c.consumedAt).forEach((c) => apply(c, data));
      },
    },
    order: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => orders.filter((o) => match(o, where)),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = orders.filter((o) => match(o, where));
        found.forEach((o) => apply(o, data));
        return { count: found.length };
      },
    },
    customerAddress: { deleteMany: removeWhere(addresses) },
    pushSubscription: { deleteMany: removeWhere(pushes) },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: "a".repeat(64), otpDevCodes: true });
  return { app, customers, codes, orders, addresses, pushes };
}

async function signIn(app: ReturnType<typeof setup>["app"], phone: string) {
  const sent = await request(app).post("/api/customer/otp/request").send({ phone }).expect(200);
  const verified = await request(app).post("/api/customer/otp/verify").send({ phone, code: sent.body.devCode, name: "Kofi Mensah" }).expect(200);
  return verified.body.token as string;
}

describe("suppression d'un compte client", () => {
  it("anonymise le compte, efface adresses et abonnements, et ne rend pas ses commandes au prochain compte du même numéro", async () => {
    const { app, customers, codes, orders, addresses, pushes } = setup();
    const token = await signIn(app, "90 12 34 56");
    const id = customers[0].id;
    orders.push({ id: "o1", customerId: id, customerPhone: "+22890123456" });
    addresses.push({ id: "a1", customerId: id });
    pushes.push({ id: "p1", role: "customer", subject: id }, { id: "p2", role: "driver", subject: "autre" });

    await request(app).delete("/api/customer/me").set("authorization", `Bearer ${token}`).expect(204);
    expect(customers[0]).toMatchObject({ phone: `supprime:${id}`, name: null, email: null, pinHash: null });
    expect(customers[0].deletedAt).toBeInstanceOf(Date);
    expect(addresses).toHaveLength(0);
    expect(pushes.map((p) => p.id)).toEqual(["p2"]);
    // Le jeton ne marche plus.
    await request(app).get("/api/customer/me").set("authorization", `Bearer ${token}`).expect(401);

    // Le même numéro (revenu, ou réattribué à quelqu'un d'autre) crée un nouveau compte : l'historique supprimé ne revient pas.
    codes.forEach((c) => (c.createdAt = new Date(Date.now() - 24 * 60 * 60_000)));
    await signIn(app, "90 12 34 56");
    expect(customers).toHaveLength(2);
    expect(orders[0].customerId).toBe(id);
  });

  it("rattache toujours au nouveau compte les commandes passées sans compte avec ce numéro", async () => {
    const { app, customers, orders } = setup();
    orders.push({ id: "invite", customerId: null, customerPhone: "+22890123456" });
    await signIn(app, "90 12 34 56");
    expect(orders[0].customerId).toBe(customers[0].id);
  });
});
