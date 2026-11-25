import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { configProblems } from "./config.js";
import { isPushService } from "./notify.js";
import { orderCode } from "./pricing.js";
import type { Limiter } from "./rateLimit.js";
import { webUrl } from "./util.js";

// Les routes testées ici s'arrêtent avant la base.
const prisma = {} as PrismaClient;
const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

function limiter(allow: boolean) {
  const keys: string[] = [];
  const l: Limiter = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: allow };
    },
  };
  return { l, keys };
}

describe("limites par adresse IP", () => {
  it("bloque les essais de connexion au-delà de la limite, par adresse du visiteur", async () => {
    const login = limiter(false);
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG, limiters: { login: login.l } });
    const res = await request(app).post("/api/restaurant/login").set("cf-connecting-ip", "203.0.113.7").send({ email: "a@b.tg", password: "x" });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
    expect(login.keys).toEqual(["203.0.113.7|mail:a@b.tg"]);
    await request(app).post("/api/admin/login").send({ password: "x" }).expect(429);
    await request(app).post("/api/restaurant/password/reset").send({}).expect(429);
  });

  it("sépare le suivi par code (GET) des nouvelles commandes (POST)", async () => {
    const lookup = limiter(false);
    const forms = limiter(false);
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", limiters: { lookup: lookup.l, forms: forms.l } });
    await request(app).get("/api/orders/ZD-AAAA-BBBB").expect(429);
    await request(app).post("/api/orders").send({}).expect(429);
    expect(lookup.keys).toHaveLength(1);
    expect(forms.keys).toHaveLength(1);
  });

  it("limite les codes SMS", async () => {
    const otp = limiter(false);
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", limiters: { otp: otp.l } });
    await request(app).post("/api/customer/otp/request").send({}).expect(429);
    await request(app).post("/api/livreur/otp/verify").send({}).expect(429);
  });

  it("plus d'inscription en ligne pour les commerces et les livreurs : comptes créés dans l'admin", async () => {
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" });
    await request(app).post("/api/vendor-applications").send({ businessName: "Chez Afi" }).expect(404);
    await request(app).post("/api/drivers/apply").send({ name: "Kossi", phone: "90123456", vehicle: "MOTO" }).expect(404);
    await request(app).get("/api/vendor-plans").expect(404);
  });

  it("deux clients derrière la même adresse d'opérateur ont chacun leur compteur", async () => {
    const login = limiter(true);
    const otp = limiter(true);
    const ipBurst = limiter(true);
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG, limiters: { login: login.l, otp: otp.l, ipBurst: ipBurst.l } });
    const ip = "102.64.0.9";
    await request(app).post("/api/customer/pin/login").set("cf-connecting-ip", ip).send({ phone: "+228 90 12 34 56", pin: "0000" });
    await request(app).post("/api/livreur/pin/login").set("cf-connecting-ip", ip).send({ email: " Kossi@Zedeka.TG ", pin: "0000" });
    await request(app).post("/api/customer/otp/request").set("cf-connecting-ip", ip).send({ phone: "91 00 00 01" });
    await request(app).post("/api/admin/login").set("cf-connecting-ip", ip).send({ password: "x" });
    expect(login.keys).toEqual([`${ip}|tel:90123456`, `${ip}|mail:kossi@zedeka.tg`, ip]);
    expect(otp.keys).toEqual([`${ip}|tel:91000001`]);
    // Le plafond large compte toutes ces requêtes sur l'adresse seule.
    expect(ipBurst.keys).toEqual([ip, ip, ip, ip]);
  });

  it("le plafond large par adresse bloque avant les limites par compte", async () => {
    const login = limiter(true);
    const ipBurst = limiter(false);
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG, limiters: { login: login.l, ipBurst: ipBurst.l } });
    await request(app).post("/api/customer/pin/login").send({ phone: "90123456", pin: "0000" }).expect(429);
    expect(login.keys).toHaveLength(0);
  });

  it("laisse passer si le service de limites est en panne", async () => {
    const broken: Limiter = { limit: async () => Promise.reject(new Error("panne")) };
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "", adminSecret: "", limiters: { login: broken } });
    const res = await request(app).post("/api/admin/login").send({ password: "x" });
    expect(res.status).not.toBe(429);
  });
});

describe("connexion admin et secrets", () => {
  it("refuse la connexion admin tant que les secrets sont faibles", async () => {
    const weak = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "changer-moi", adminSecret: "court" });
    await request(weak).post("/api/admin/login").send({ password: "changer-moi" }).expect(503);
    const ok = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });
    await request(ok).post("/api/admin/login").send({ password: "faux" }).expect(401);
    const res = await request(ok).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
    expect(res.body.token).toBeTruthy();
  });

  it("liste les secrets à corriger", () => {
    expect(configProblems({ adminPassword: "changer-moi", adminSecret: "x" })).toHaveLength(2);
    expect(configProblems(STRONG)).toEqual([]);
  });
});

describe("entrées", () => {
  it("n'accepte que les services push des navigateurs (pas de SSRF)", () => {
    expect(isPushService("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushService("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushService("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isPushService("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushService("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushService("https://zedeka.poinderecharge.com/api/admin")).toBe(false);
    expect(isPushService("http://169.254.169.254/latest")).toBe(false);
    expect(isPushService("pas une adresse")).toBe(false);
  });

  it("refuse un panier de plus de 50 lignes avant de toucher la base", async () => {
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" });
    const items = Array.from({ length: 51 }, () => ({ menuItemId: "m", quantity: 1 }));
    const res = await request(app).post("/api/orders").send({ acceptTerms: true, zoneId: "z", customerName: "Ama", customerPhone: "+228 90 00 00 00", paymentMethod: "CASH", restaurantSlug: "r", items }).expect(400);
    expect(res.body.error).toContain("Panier trop grand");
  });

  it("refuse les liens d'image qui ne sont pas en https", () => {
    expect(webUrl.safeParse("https://exemple.tg/logo.png").success).toBe(true);
    expect(webUrl.safeParse("javascript:alert(1)").success).toBe(false);
    expect(webUrl.safeParse("data:image/png;base64,AAAA").success).toBe(false);
    expect(webUrl.safeParse("http://exemple.tg/logo.png").success).toBe(false);
  });

  it("tire les codes de commande au hasard cryptographique", () => {
    const codes = new Set(Array.from({ length: 200 }, () => orderCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^ZD-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("ajoute les en-têtes de sécurité et masque Express", async () => {
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" });
    const res = await request(app).get("/api/health").expect(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
