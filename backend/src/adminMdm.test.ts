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
