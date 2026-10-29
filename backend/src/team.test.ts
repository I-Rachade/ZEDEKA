import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { dispatcherMay } from "./team.js";

describe("droits du dispatcheur", () => {
  it("ouvre les commandes, la répartition et les livreurs, pas les finances ni les réglages", () => {
    expect(dispatcherMay("GET", "/dispatch")).toBe(true);
    expect(dispatcherMay("POST", "/dispatch/issues/abc/resolve")).toBe(true);
    expect(dispatcherMay("PATCH", "/orders/abc")).toBe(true);
    expect(dispatcherMay("GET", "/drivers")).toBe(true);
    expect(dispatcherMay("PATCH", "/drivers/abc")).toBe(true);
    expect(dispatcherMay("POST", "/drivers")).toBe(false);
    expect(dispatcherMay("GET", "/restaurants/abc")).toBe(true);
    expect(dispatcherMay("PATCH", "/restaurants/abc")).toBe(false);
    expect(dispatcherMay("GET", "/finance/cash")).toBe(false);
    expect(dispatcherMay("GET", "/report")).toBe(false);
    expect(dispatcherMay("GET", "/settings")).toBe(false);
    expect(dispatcherMay("GET", "/team")).toBe(false);
    expect(dispatcherMay("GET", "/vendor-applications")).toBe(false);
  });
});

describe("comptes de l'équipe", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const members = [
    { id: "m1", name: "Koffi", email: "koffi@zedeka.tg", passwordHash: bcrypt.hashSync("dispatch-2026", 4), role: "DISPATCHER", active: true },
    { id: "m2", name: "Ama", email: "ama@zedeka.tg", passwordHash: bcrypt.hashSync("ancien-compte", 4), role: "DISPATCHER", active: false },
  ];
  const prisma = {
    teamMember: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => members.find((m) => m.id === where.id || m.email === where.email) ?? null,
      update: async () => ({}),
    },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });

  it("connecte un membre avec son adresse et limite le dispatcheur à ses écrans", async () => {
    await request(app).post("/api/admin/login").send({ email: "koffi@zedeka.tg", password: "faux" }).expect(401);
    const res = await request(app).post("/api/admin/login").send({ email: " Koffi@Zedeka.tg ", password: "dispatch-2026" }).expect(200);
    expect(res.body.role).toBe("DISPATCHER");
    const auth = { authorization: `Bearer ${res.body.token}` };
    const me = await request(app).get("/api/admin/me").set(auth).expect(200);
    expect(me.body).toEqual({ id: "m1", name: "Koffi", role: "DISPATCHER" });
    await request(app).get("/api/admin/settings").set(auth).expect(403);
    await request(app).get("/api/admin/team").set(auth).expect(403);
  });

  it("refuse un compte désactivé, même avec un jeton encore valide", async () => {
    await request(app).post("/api/admin/login").send({ email: "ama@zedeka.tg", password: "ancien-compte" }).expect(401);
    const ok = await request(app).post("/api/admin/login").send({ email: "koffi@zedeka.tg", password: "dispatch-2026" }).expect(200);
    members[0].active = false;
    await request(app).get("/api/admin/me").set({ authorization: `Bearer ${ok.body.token}` }).expect(401);
    members[0].active = true;
  });

  it("garde le mot de passe du directeur", async () => {
    const res = await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
    const me = await request(app).get("/api/admin/me").set({ authorization: `Bearer ${res.body.token}` }).expect(200);
    expect(me.body.role).toBe("DIRECTOR");
  });
});
