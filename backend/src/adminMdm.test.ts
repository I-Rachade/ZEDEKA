import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { staffMay } from "./team.js";

// Parc mobile : l'admin ouvre la console MDM avec un jeton signé d'une minute.
describe("ouverture du parc mobile (MDM)", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const SSO = "s".repeat(48);
  const prisma = { teamMember: { findMany: async () => [], findUnique: async () => null } } as unknown as PrismaClient;
  const login = async (app: ReturnType<typeof createApp>) =>
    (await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200)).body.token as string;

  it("renvoie l'adresse de la console avec un jeton signé, valable une minute", async () => {
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG, mdm: { url: "https://mdm.exemple.tg/", ssoSecret: SSO } });
    const token = await login(app);
    const res = await request(app).post("/api/admin/mdm/session").set({ authorization: `Bearer ${token}` }).expect(200);
    const [base, jwt] = res.body.url.split("#sso=");
    expect(base).toBe("https://mdm.exemple.tg/");
    const [head, body, sig] = jwt.split(".");
    expect(createHmac("sha256", SSO).update(`${head}.${body}`).digest("base64url")).toBe(sig);
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    expect(claims).toMatchObject({ iss: "zedeka", aud: "mdm", role: "admin", name: "Directeur des opérations" });
    expect(claims.exp - claims.iat).toBe(60);
    expect(typeof claims.jti).toBe("string");
  });

  it("indique que le parc n'est pas installé sans secret", async () => {
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });
    const token = await login(app);
    await request(app).post("/api/admin/mdm/session").set({ authorization: `Bearer ${token}` }).expect(503);
  });

  it("refuse sans connexion admin", async () => {
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG, mdm: { url: "https://mdm.exemple.tg", ssoSecret: SSO } });
    await request(app).post("/api/admin/mdm/session").expect(401);
  });

  it("fermé à la managerin et au dispatcheur", () => {
    expect(staffMay("MANAGER", "POST", "/mdm/session")).toBe(false);
    expect(staffMay("DISPATCHER", "POST", "/mdm/session")).toBe(false);
    expect(staffMay("DEPUTY", "POST", "/mdm/session")).toBe(true);
  });
});

// Liaison dans les deux sens avec la console MDM : alertes graves vers l'équipe, départ d'un membre vers le parc.
describe("parc mobile : alertes et départ d'un membre", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const SSO = "s".repeat(48);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sign = (claims: Record<string, unknown>, secret = SSO) => {
    const h = b64({ alg: "HS256", typ: "JWT" });
    const b = b64(claims);
    return `${h}.${b}.${createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url")}`;
  };
  const now = () => Math.floor(Date.now() / 1000);

  function setup() {
    const sent: { category: string; payload: { title: string; body: string; alarm?: boolean } }[] = [];
    const calls: { url: string; body: string }[] = [];
    const notifier = { publicKey: "", push: async () => 0, staff: async (category: string, payload: never) => (sent.push({ category, payload }), 1), sms: async () => {} };
    const member = { id: "m1", active: true, email: "Ama@Zedeka.tg", name: "Ama", role: "DISPATCHER", lastLoginAt: null, createdAt: new Date() };
    const prisma = {
      teamMember: { findMany: async () => [], findUnique: async () => member, update: async () => ({ ...member, active: false }) },
    } as unknown as PrismaClient;
    const fetcher = async (url: string, init: RequestInit) => (calls.push({ url, body: String(init.body) }), new Response(null, { status: 200 }));
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG, notifier: notifier as never, mdm: { url: "https://mdm.exemple.tg", ssoSecret: SSO, fetcher } });
    return { app, sent, calls };
  }

  it("alerte critique de la console : notification « Technique » avec alarme", async () => {
    const { app, sent } = setup();
    const token = sign({ iss: "zedeka-mdm", aud: "zedeka", iat: now(), exp: now() + 60, alert_id: 7, severity: "critique", message: "Tél. livreur déclaré volé" });
    await request(app).post("/api/mdm/alerts").send({ token }).expect(204);
    expect(sent).toEqual([{ category: "TECH", payload: expect.objectContaining({ body: "Tél. livreur déclaré volé", alarm: true, url: "/admin/mdm" }) }]);
  });

  it("refuse un jeton forgé, expiré ou destiné à la console", async () => {
    const { app, sent } = setup();
    const base = { iss: "zedeka-mdm", aud: "zedeka", iat: now(), exp: now() + 60, severity: "haute", message: "x" };
    await request(app).post("/api/mdm/alerts").send({ token: sign(base, "f".repeat(48)) }).expect(401);
    await request(app).post("/api/mdm/alerts").send({ token: sign({ ...base, exp: now() - 5 }) }).expect(401);
    await request(app).post("/api/mdm/alerts").send({ token: sign({ ...base, aud: "mdm" }) }).expect(401);
    await request(app).post("/api/mdm/alerts").send({}).expect(401);
    expect(sent).toHaveLength(0);
  });

  it("membre désactivé dans l'équipe : la console MDM est prévenue (jeton « mdm-events »)", async () => {
    const { app, calls } = setup();
    const login = (await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200)).body.token as string;
    await request(app).patch("/api/admin/team/m1").set({ authorization: `Bearer ${login}` }).send({ active: false }).expect(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mdm.exemple.tg/api/integration/zedeka/member-left");
    const claims = JSON.parse(Buffer.from(JSON.parse(calls[0].body).token.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({ iss: "zedeka", aud: "mdm-events", event: "member_left", email: "ama@zedeka.tg" });
  });

  it("simple changement de nom : rien n'est envoyé", async () => {
    const { app, calls } = setup();
    const login = (await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200)).body.token as string;
    await request(app).patch("/api/admin/team/m1").set({ authorization: `Bearer ${login}` }).send({ name: "Ama K." }).expect(200);
    expect(calls).toHaveLength(0);
  });
});
