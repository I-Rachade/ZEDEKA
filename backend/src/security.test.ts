import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { configProblems, otpDevCodes } from "./config.js";
import { orderCode } from "./pricing.js";
import { onlyFor, rateLimit } from "./rateLimit.js";

describe("rateLimit", () => {
  it("bloque au-delà du maximum puis repart après la fenêtre", async () => {
    let t = 0;
    const app = express();
    app.use(rateLimit({ windowMs: 1000, max: 2 }, () => t));
    app.get("/", (_req, res) => {
      res.json({ ok: true });
    });
    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
    const blocked = await request(app).get("/");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("1");
    t = 1001;
    expect((await request(app).get("/")).status).toBe(200);
  });

  it("onlyFor ne compte que les méthodes données", async () => {
    const app = express();
    app.use(onlyFor(["POST"], rateLimit({ windowMs: 60_000, max: 1 })));
    app.all("/", (_req, res) => {
      res.json({ ok: true });
    });
    for (let i = 0; i < 3; i++) expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).post("/")).status).toBe(200);
    expect((await request(app).post("/")).status).toBe(429);
  });
});

describe("configuration", () => {
  const good = { ADMIN_PASSWORD: "un-mot-de-passe-long", ADMIN_SECRET: "a".repeat(32) };

  it("accepte une configuration solide", () => {
    expect(configProblems(good)).toEqual([]);
  });

  it("refuse les valeurs d'exemple, trop courtes et les codes de test", () => {
    expect(configProblems({ ADMIN_PASSWORD: "changer-moi", ADMIN_SECRET: "une-longue-chaine-aleatoire" })).toHaveLength(2);
    expect(configProblems({ ...good, OTP_DEV_CODES: "true" })).toHaveLength(1);
  });

  it("n'affiche jamais les codes en production, et seulement sur demande ailleurs", () => {
    expect(otpDevCodes({ OTP_DEV_CODES: "true", NODE_ENV: "production" })).toBe(false);
    expect(otpDevCodes({ OTP_DEV_CODES: "true" })).toBe(true);
    expect(otpDevCodes({})).toBe(false);
  });
});

describe("orderCode", () => {
  it("utilise par défaut un tirage cryptographique au bon format", () => {
    const codes = new Set(Array.from({ length: 200 }, () => orderCode()));
    for (const c of codes) expect(c).toMatch(/^ZD-[A-Z2-9]{4}$/);
    expect(codes.size).toBeGreaterThan(190);
  });
});
