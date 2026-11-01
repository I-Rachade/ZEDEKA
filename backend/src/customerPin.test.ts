import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { EmailSender } from "./email.js";
import { hashPin, isWeakPin } from "./pin.js";

type Row = Record<string, unknown> & { id: string };

// Base en mémoire : juste ce qu'utilisent les routes de connexion des clients.
function fakePrisma() {
  const customers: Row[] = [];
  const codes: Row[] = [];
  let n = 0;
  const match = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => row[k] === v);
  const apply = (row: Row, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      row[k] = v && typeof v === "object" && "increment" in v ? (row[k] as number) + (v.increment as number) : v;
    }
    return row;
  };
  const prisma = {
    customer: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => customers.find((c) => match(c, where)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => customers.find((c) => match(c, where))!,
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => apply(customers.find((c) => match(c, where))!, data),
      upsert: async ({ where, update, create }: { where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const found = customers.find((c) => match(c, where));
        if (found) return apply(found, update);
        const row = { id: `c${++n}`, name: null, email: null, pinHash: null, pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null, deletedAt: null, ...create };
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
    order: { findMany: async () => [], findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
  };
  return { prisma: prisma as unknown as PrismaClient, customers, codes };
}

const SECRET = "a".repeat(64);
const appFor = (prisma: PrismaClient, emailSender?: EmailSender) =>
  createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: SECRET, otpDevCodes: true, emailSender });

// Inscription complète : code SMS, puis PIN choisi sans l'ancien.
async function register(app: ReturnType<typeof appFor>, phone = "90 12 34 56", email?: string) {
  const sent = await request(app).post("/api/customer/otp/request").send({ phone }).expect(200);
  const verified = await request(app).post("/api/customer/otp/verify").send({ phone, code: sent.body.devCode, name: "Kofi Mensah", email }).expect(200);
  expect(verified.body.customer.hasPin).toBe(false);
  await request(app).put("/api/customer/me/pin").set("authorization", `Bearer ${verified.body.token}`).send({ pin: "2580" }).expect(200);
  return verified.body.token as string;
}

describe("code PIN", () => {
  it("refuse les PIN trop faciles", () => {
    for (const pin of ["0000", "1234", "4321", "1212", "1122", "6789"]) expect(isWeakPin(pin)).toBe(true);
    for (const pin of ["2580", "1390", "7042"]) expect(isWeakPin(pin)).toBe(false);
  });

  it("inscription par SMS, puis connexion par téléphone ou e-mail avec le PIN", async () => {
    const { prisma } = fakePrisma();
    const app = appFor(prisma);
    await register(app, "90 12 34 56", "Kofi@Example.tg");
    const byPhone = await request(app).post("/api/customer/pin/login").send({ phone: "+228 90 12 34 56", pin: "2580" }).expect(200);
    expect(byPhone.body.customer).toMatchObject({ phone: "+22890123456", email: "kofi@example.tg", hasPin: true });
    await request(app).post("/api/customer/pin/login").send({ email: "kofi@example.tg", pin: "2580" }).expect(200);
  });

  it("refuse un PIN faible au moment de le choisir", async () => {
    const { prisma } = fakePrisma();
    const app = appFor(prisma);
    const sent = await request(app).post("/api/customer/otp/request").send({ phone: "90123456" });
    const { body } = await request(app).post("/api/customer/otp/verify").send({ phone: "90123456", code: sent.body.devCode });
    const res = await request(app).put("/api/customer/me/pin").set("authorization", `Bearer ${body.token}`).send({ pin: "1234" }).expect(400);
    expect(res.body.error).toBe("Code PIN trop facile à deviner. Évitez 1234, 0000 ou 1212.");
  });

  it("même message pour un compte inconnu et un PIN faux, blocage après 5 essais", async () => {
    const { prisma, customers } = fakePrisma();
    const app = appFor(prisma);
    await register(app);
    const unknown = await request(app).post("/api/customer/pin/login").send({ phone: "91000000", pin: "2580" }).expect(400);
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post("/api/customer/pin/login").send({ phone: "90123456", pin: "9137" }).expect(400);
      expect(res.body.error).toBe(unknown.body.error);
    }
    await request(app).post("/api/customer/pin/login").send({ phone: "90123456", pin: "9137" }).expect(429);
    // Bloqué : même le bon PIN est refusé.
    await request(app).post("/api/customer/pin/login").send({ phone: "90123456", pin: "2580" }).expect(429);
    expect(customers[0].pinLockedUntil).toBeInstanceOf(Date);
  });

  it("client existant sans PIN : invité à recevoir un code SMS", async () => {
    const { prisma } = fakePrisma();
    const app = appFor(prisma);
    const sent = await request(app).post("/api/customer/otp/request").send({ phone: "90123456" });
    await request(app).post("/api/customer/otp/verify").send({ phone: "90123456", code: sent.body.devCode });
    const res = await request(app).post("/api/customer/pin/login").send({ phone: "90123456", pin: "2580" }).expect(400);
    expect(res.body.noPin).toBe(true);
  });

  it("changer de PIN depuis le profil demande l'ancien", async () => {
    const { prisma, customers } = fakePrisma();
    const app = appFor(prisma);
    const token = await register(app);
    customers[0].pinResetUntil = null;
    const auth = { authorization: `Bearer ${token}` };
    await request(app).put("/api/customer/me/pin").set(auth).send({ pin: "7042" }).expect(400);
    await request(app).put("/api/customer/me/pin").set(auth).send({ pin: "7042", currentPin: "1111" }).expect(400);
    await request(app).put("/api/customer/me/pin").set(auth).send({ pin: "7042", currentPin: "2580" }).expect(200);
    await request(app).post("/api/customer/pin/login").send({ phone: "90123456", pin: "7042" }).expect(200);
  });

  it("PIN oublié par e-mail : code envoyé à l'adresse du compte, puis nouveau PIN sans l'ancien", async () => {
    const { prisma, customers } = fakePrisma();
    const mails: { to: string; text: string }[] = [];
    const app = appFor(prisma, { send: async (to, _subject, text) => void mails.push({ to, text }) });
    await register(app, "90123456", "kofi@example.tg");
    customers[0].pinResetUntil = null;
    const sent = await request(app).post("/api/customer/email/request").send({ email: "KOFI@example.tg" }).expect(200);
    expect(sent.body.devCode).toBeUndefined();
    expect(mails).toHaveLength(1);
    const code = /(\d{6})/.exec(mails[0].text)![1];
    await request(app).post("/api/customer/email/verify").send({ email: "kofi@example.tg", code: "000000" === code ? "111111" : "000000" }).expect(400);
    const ok = await request(app).post("/api/customer/email/verify").send({ email: "kofi@example.tg", code }).expect(200);
    await request(app).put("/api/customer/me/pin").set("authorization", `Bearer ${ok.body.token}`).send({ pin: "7042" }).expect(200);
    await request(app).post("/api/customer/pin/login").send({ email: "kofi@example.tg", pin: "7042" }).expect(200);
  });

  it("adresse inconnue : même réponse, aucun e-mail envoyé", async () => {
    const { prisma } = fakePrisma();
    const mails: string[] = [];
    const app = appFor(prisma, { send: async (to) => void mails.push(to) });
    await request(app).post("/api/customer/email/request").send({ email: "personne@example.tg" }).expect(200);
    expect(mails).toHaveLength(0);
  });

  it("e-mail déjà pris par un autre compte refusé à l'inscription", async () => {
    const { prisma, customers } = fakePrisma();
    const app = appFor(prisma);
    customers.push({ id: "x", phone: "+22899999999", email: "kofi@example.tg", pinHash: await hashPin("2580"), deletedAt: null });
    const sent = await request(app).post("/api/customer/otp/request").send({ phone: "90123456" });
    await request(app).post("/api/customer/otp/verify").send({ phone: "90123456", code: sent.body.devCode, email: "kofi@example.tg" }).expect(409);
  });
});

describe("e-mails par Cloudflare Email Service", () => {
  it("passe l'expéditeur nommé et le texte à la liaison", async () => {
    const { cloudflareSender } = await import("./email.js");
    const sent: { text: string }[] = [];
    const sender = cloudflareSender({ send: async (m) => (sent.push(m), { messageId: "1" }) }, "Zedeka <codes@poinderecharge.com>", "https://z.tg/");
    await sender.send("kofi@example.tg", "Votre code", "123456");
    expect(sent).toEqual([{ from: { name: "Zedeka", email: "codes@poinderecharge.com" }, to: "kofi@example.tg", subject: "Votre code", text: expect.stringMatching(/^123456\n/) }]);
    // Pied : e-mail de service, comment ne plus en recevoir et lien de suppression des données.
    expect(sent[0].text).toContain("pas de publicité");
    expect(sent[0].text).toContain("https://z.tg/suppression-donnees");
  });
});
