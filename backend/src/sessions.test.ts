import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { CUSTOMER_TOKEN_TTL_MS, issueToken } from "./auth.js";

// Déconnexion côté serveur des clients et des livreurs (sessionsValidFrom).

const SECRET = "s".repeat(64);
const HOUR = 60 * 60_000;

function setup() {
  const customer = { id: "c1", deletedAt: null as Date | null, sessionsValidFrom: null as Date | null };
  const driver = { id: "d1", status: "APPROVED", active: true, sessionsValidFrom: null as Date | null, online: true };
  const pushDeleted: unknown[] = [];
  const prisma = {
    customer: {
      findUnique: async () => customer,
      findUniqueOrThrow: async () => ({ phone: "+22890000000", name: "Ama", createdAt: new Date(), addresses: [] }),
      update: async ({ data }: { data: Partial<typeof customer> }) => Object.assign(customer, data),
    },
    driver: {
      findUnique: async () => driver,
      update: async ({ data }: { data: Partial<typeof driver> }) => Object.assign(driver, data),
    },
    pushSubscription: { deleteMany: async (q: unknown) => pushDeleted.push(q) },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: SECRET });
  const token = (role: "customer" | "driver", id: string, at = Date.now()) => ({ authorization: `Bearer ${issueToken(SECRET, at, role, id, CUSTOMER_TOKEN_TTL_MS)}` });
  return { app, customer, driver, pushDeleted, token };
}

describe("sessions des clients", () => {
  it("« tous les appareils » ferme les jetons déjà émis, une nouvelle connexion marche", async () => {
    const { app, customer, token } = setup();
    const old = token("customer", "c1", Date.now() - HOUR);
    await request(app).get("/api/customer/me").set(old).expect(200);
    await request(app).post("/api/customer/sessions/logout-all").set(old).expect(204);
    expect(customer.sessionsValidFrom).toBeInstanceOf(Date);
    await request(app).get("/api/customer/me").set(old).expect(401);
    await request(app).get("/api/customer/me").set(token("customer", "c1", Date.now() + 1000)).expect(200);
  });
});

describe("sessions des livreurs", () => {
  it("« tous les appareils » ferme les jetons, met hors ligne et coupe les alertes", async () => {
    const { app, driver, pushDeleted, token } = setup();
    const old = token("driver", "d1", Date.now() - HOUR);
    await request(app).post("/api/livreur/sessions/logout-all").set(old).expect(204);
    expect(driver.online).toBe(false);
    expect(pushDeleted).toEqual([{ where: { role: "driver", subject: "d1" } }]);
    await request(app).patch("/api/livreur/online").set(old).send({ online: true }).expect(401);
  });

  it("un livreur suspendu puis réactivé doit se reconnecter", async () => {
    const { app, driver, token } = setup();
    const old = token("driver", "d1", Date.now() - HOUR);
    // Ce que fait l'admin en suspendant : sessionsValidFrom = maintenant.
    driver.sessionsValidFrom = new Date();
    driver.active = true;
    const res = await request(app).patch("/api/livreur/online").set(old).send({ online: true }).expect(401);
    expect(res.body.error).toMatch(/reconnectez-vous/);
  });
});

describe("admin et sessions des livreurs", () => {
  it("suspendre un livreur ou changer son numéro ferme ses sessions", async () => {
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      driver: { update: async ({ data }: { data: Record<string, unknown> }) => (updates.push(data), { id: "d1", ...data }) },
    } as unknown as PrismaClient;
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: SECRET });
    const auth = { authorization: `Bearer ${issueToken(SECRET)}` };
    await request(app).patch("/api/admin/drivers/d1").set(auth).send({ active: false }).expect(200);
    await request(app).patch("/api/admin/drivers/d1").set(auth).send({ phone: "+228 91 00 00 00" }).expect(200);
    await request(app).patch("/api/admin/drivers/d1").set(auth).send({ online: false }).expect(200);
    expect(updates.map((u) => u.sessionsValidFrom instanceof Date)).toEqual([true, true, false]);
  });
});
