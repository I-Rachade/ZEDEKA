import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { EmailSender } from "./email.js";
import { hashPin, withoutPin } from "./pin.js";

type Row = Record<string, unknown> & { id: string };

// Base en mémoire : juste ce qu'utilisent l'inscription et la connexion des livreurs.
function fakePrisma() {
  const drivers: Row[] = [];
  const codes: Row[] = [];
  let n = 0;
  const match = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => row[k] === v);
  const apply = (row: Row, data: Record<string, unknown>) => Object.assign(row, data);
  const prisma = {
    driver: {
      findMany: async ({ where }: { where: { phone: { endsWith: string } } }) => drivers.filter((d) => String(d.phone).endsWith(where.phone.endsWith)),
      findUnique: async ({ where }: { where: Record<string, unknown> }) => drivers.find((d) => match(d, where)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => drivers.find((d) => match(d, where))!,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `d${++n}`, active: true, status: "APPROVED", pinHash: null, pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null, createdAt: new Date(), ...data };
        drivers.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => apply(drivers.find((d) => match(d, where))!, data),
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
  };
  return { prisma: prisma as unknown as PrismaClient, drivers };
}

const SECRET = "a".repeat(64);
const appFor = (prisma: PrismaClient, emailSender?: EmailSender) =>
  createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: SECRET, otpDevCodes: true, emailSender });
const apply = (app: ReturnType<typeof appFor>, pin = "2580", email?: string) =>
  request(app).post("/api/drivers/apply").send({ name: "Kossi Agbeko", phone: "90 12 34 56", vehicle: "MOTO", pin, email, acceptTerms: true });

describe("connexion des livreurs par code PIN", () => {
  it("candidature avec PIN : le livreur voit où elle en est, puis entre dans l'appli une fois validé", async () => {
    const { prisma, drivers } = fakePrisma();
    const app = appFor(prisma);
    await apply(app).expect(201);
    expect(drivers[0].pinHash).toMatch(/^\$2/);
    const pending = await request(app).post("/api/livreur/pin/login").send({ phone: "90123456", pin: "2580" }).expect(200);
    expect(pending.body.token).toBeUndefined();
    expect(pending.body.application).toMatchObject({ name: "Kossi Agbeko", status: "PENDING" });
    Object.assign(drivers[0], { status: "APPROVED", active: true });
    const ok = await request(app).post("/api/livreur/pin/login").send({ phone: "+228 90 12 34 56", pin: "2580" }).expect(200);
    expect(ok.body.driver).toMatchObject({ name: "Kossi Agbeko", hasPin: true });
    expect(ok.body.token).toBeTruthy();
  });

  it("refuse une candidature sans PIN ou avec un PIN trop facile", async () => {
    const { prisma } = fakePrisma();
    const app = appFor(prisma);
    await request(app).post("/api/drivers/apply").send({ name: "Kossi Agbeko", phone: "90123456", vehicle: "MOTO" }).expect(400);
    await apply(app, "1234").expect(400);
  });

  it("même message pour un numéro inconnu et un PIN faux, blocage après 5 essais", async () => {
    const { prisma, drivers } = fakePrisma();
    const app = appFor(prisma);
    await apply(app).expect(201);
    const unknown = await request(app).post("/api/livreur/pin/login").send({ phone: "91000000", pin: "2580" }).expect(400);
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post("/api/livreur/pin/login").send({ phone: "90123456", pin: "9137" }).expect(400);
      expect(res.body.error).toBe(unknown.body.error);
    }
    await request(app).post("/api/livreur/pin/login").send({ phone: "90123456", pin: "9137" }).expect(429);
    await request(app).post("/api/livreur/pin/login").send({ phone: "90123456", pin: "2580" }).expect(429);
    expect(drivers[0].pinLockedUntil).toBeInstanceOf(Date);
  });

  it("livreur ajouté sans PIN : invité au code SMS, puis choisit son PIN", async () => {
    const { prisma, drivers } = fakePrisma();
    const app = appFor(prisma);
    drivers.push({ id: "d0", name: "Afi", phone: "+22890123456", status: "APPROVED", active: true, pinHash: null, pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null, createdAt: new Date() });
    const res = await request(app).post("/api/livreur/pin/login").send({ phone: "90123456", pin: "2580" }).expect(400);
    expect(res.body.noPin).toBe(true);
    const sent = await request(app).post("/api/livreur/otp/request").send({ phone: "90123456" }).expect(200);
    const verified = await request(app).post("/api/livreur/otp/verify").send({ phone: "90123456", code: sent.body.devCode }).expect(200);
    expect(verified.body.driver.hasPin).toBe(false);
    await request(app).put("/api/livreur/me/pin").set("authorization", `Bearer ${verified.body.token}`).send({ pin: "7042" }).expect(200);
    await request(app).post("/api/livreur/pin/login").send({ phone: "90123456", pin: "7042" }).expect(200);
  });

  it("changer de PIN hors code SMS demande l'ancien", async () => {
    const { prisma, drivers } = fakePrisma();
    const app = appFor(prisma);
    drivers.push({ id: "d0", name: "Afi", phone: "+22890123456", status: "APPROVED", active: true, pinHash: await hashPin("2580"), pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null, createdAt: new Date() });
    const { body } = await request(app).post("/api/livreur/pin/login").send({ phone: "90123456", pin: "2580" }).expect(200);
    const auth = { authorization: `Bearer ${body.token}` };
    await request(app).put("/api/livreur/me/pin").set(auth).send({ pin: "7042" }).expect(400);
    await request(app).put("/api/livreur/me/pin").set(auth).send({ pin: "7042", currentPin: "2580" }).expect(200);
  });

  it("les fiches livreurs ne contiennent jamais le PIN", () => {
    const shown = withoutPin({ id: "d1", name: "Afi", pinHash: "$2a$10$x", pinAttempts: 2, pinLockedUntil: null, pinResetUntil: null });
    expect(shown).toEqual({ id: "d1", name: "Afi", hasPin: true });
  });

  it("connexion avec l'e-mail et le PIN, e-mail facultatif et unique", async () => {
    const { prisma, drivers } = fakePrisma();
    const app = appFor(prisma);
    await apply(app, "2580", " Kossi@Example.tg ").expect(201);
    expect(drivers[0].email).toBe("kossi@example.tg");
    Object.assign(drivers[0], { status: "APPROVED", active: true });
    const ok = await request(app).post("/api/livreur/pin/login").send({ email: "KOSSI@example.tg", pin: "2580" }).expect(200);
    expect(ok.body.token).toBeTruthy();
    const wrong = await request(app).post("/api/livreur/pin/login").send({ email: "kossi@example.tg", pin: "9137" }).expect(400);
    expect(wrong.body.error).toBe("Identifiant ou code PIN incorrect");
    const taken = await request(app).post("/api/drivers/apply").send({ name: "Autre", phone: "91 00 00 00", vehicle: "MOTO", pin: "2580", email: "kossi@example.tg", acceptTerms: true }).expect(409);
    expect(taken.body.error).toMatch(/e-mail/);
    await request(app).post("/api/drivers/apply").send({ name: "Sans mail", phone: "92 00 00 00", vehicle: "MOTO", pin: "2580", email: "", acceptTerms: true }).expect(201);
    expect(drivers[1].email).toBeNull();
  });

  it("PIN oublié par e-mail : code envoyé à l'adresse du livreur, puis nouveau PIN sans l'ancien", async () => {
    const { prisma, drivers } = fakePrisma();
    const mails: { to: string; text: string }[] = [];
    const app = appFor(prisma, { send: async (to, _subject, text) => void mails.push({ to, text }) });
    drivers.push({ id: "d0", name: "Afi", phone: "+22890123456", email: "afi@example.tg", status: "APPROVED", active: true, pinHash: await hashPin("2580"), pinAttempts: 0, pinLockedUntil: null, pinResetUntil: null, createdAt: new Date() });
    await request(app).post("/api/livreur/email/request").send({ email: "inconnu@example.tg" }).expect(200);
    expect(mails).toHaveLength(0);
    await request(app).post("/api/livreur/email/request").send({ email: "AFI@example.tg" }).expect(200);
    expect(mails[0].to).toBe("afi@example.tg");
    const code = /(\d{6})/.exec(mails[0].text)![1];
    const ok = await request(app).post("/api/livreur/email/verify").send({ email: "afi@example.tg", code }).expect(200);
    await request(app).put("/api/livreur/me/pin").set("authorization", `Bearer ${ok.body.token}`).send({ pin: "7042" }).expect(200);
    await request(app).post("/api/livreur/pin/login").send({ email: "afi@example.tg", pin: "7042" }).expect(200);
  });
});
