import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { EmailSender } from "./email.js";

// Mot de passe oublié d'un restaurant : le code part par e-mail à l'adresse de connexion.
type Reset = { id: number; role: string; subject: string; codeHash: string; expiresAt: Date; createdAt: Date; attempts: number; consumedAt: Date | null };

function setup(opts: { email?: EmailSender; devCodes?: boolean } = {}) {
  const restaurant = { id: "r1", name: "Chez Ama", phone: "+228 90 00 00 00", ownerEmail: "gerant@ama.tg", ownerPasswordHash: bcrypt.hashSync("ancien-2026", 4), sessionsValidFrom: null as Date | null };
  const resets: Reset[] = [];
  const prisma = {
    restaurant: {
      findUnique: async ({ where }: { where: { id?: string; ownerEmail?: string } }) => (where.id === "r1" || where.ownerEmail === restaurant.ownerEmail ? { ...restaurant } : null),
      update: async ({ data }: { data: Partial<typeof restaurant> }) => Object.assign(restaurant, data),
    },
    restaurantStaff: { findUnique: async () => null },
    passwordReset: {
      count: async ({ where }: { where: { subject: string } }) => resets.filter((r) => r.subject === where.subject).length,
      create: async ({ data }: { data: Omit<Reset, "id" | "createdAt" | "attempts" | "consumedAt"> }) => {
        const row = { id: resets.length + 1, createdAt: new Date(), attempts: 0, consumedAt: null, ...data };
        resets.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: { subject: string } }) =>
        resets.filter((r) => r.subject === where.subject && !r.consumedAt).sort((a, b) => b.id - a.id)[0] ?? null,
      update: async ({ where, data }: { where: { id: number }; data: { attempts: { increment: number } } }) => {
        const row = resets.find((r) => r.id === where.id)!;
        row.attempts += data.attempts.increment;
        return row;
      },
      updateMany: async ({ data }: { data: { consumedAt: Date } }) => {
        resets.forEach((r) => (r.consumedAt ??= data.consumedAt));
        return { count: resets.length };
      },
    },
  } as unknown as PrismaClient;
  const app = createApp(prisma, {
    frontendOrigin: "",
    zedekaWhatsapp: "",
    adminPassword: "un-mot-de-passe-solide",
    adminSecret: "a".repeat(64),
    emailSender: opts.email,
    otpDevCodes: opts.devCodes ?? false,
  });
  return { app, restaurant, resets };
}

describe("mot de passe oublié des restaurants", () => {
  it("le code part par e-mail à l'adresse de connexion, puis change le mot de passe", async () => {
    const mails: { to: string; subject: string; text: string }[] = [];
    const { app, restaurant } = setup({ email: { send: async (to, subject, text) => void mails.push({ to, subject, text }) } });
    const sent = await request(app).post("/api/restaurant/password/forgot").send({ email: "Gerant@ama.tg" }).expect(200);
    expect(sent.body.devCode).toBeUndefined();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("gerant@ama.tg");
    const code = /(\d{6})/.exec(mails[0].subject)![1];
    expect(mails[0].text).toContain(code);
    expect(mails[0].text).toContain("Chez Ama");

    const reset = await request(app).post("/api/restaurant/password/reset").send({ email: "gerant@ama.tg", code, password: "nouveau-2026" }).expect(200);
    expect(reset.body.token).toBeTruthy();
    expect(await bcrypt.compare("nouveau-2026", restaurant.ownerPasswordHash)).toBe(true);
    expect(restaurant.sessionsValidFrom).toBeInstanceOf(Date);
  });

  it("adresse inconnue : même réponse, aucun e-mail", async () => {
    const mails: string[] = [];
    const { app } = setup({ email: { send: async (to) => void mails.push(to) } });
    await request(app).post("/api/restaurant/password/forgot").send({ email: "personne@ama.tg" }).expect(200);
    expect(mails).toHaveLength(0);
  });

  it("envoi en échec : erreur claire, aucun code enregistré", async () => {
    const { app, resets } = setup({
      email: {
        send: async () => {
          throw new Error("panne");
        },
      },
    });
    const res = await request(app).post("/api/restaurant/password/forgot").send({ email: "gerant@ama.tg" }).expect(502);
    expect(res.body.contactSupport).toBe(true);
    expect(resets).toHaveLength(0);
  });

  it("aucun service d'e-mail : invité à écrire à Zedeka, sans révéler si le compte existe", async () => {
    const { app } = setup();
    const known = await request(app).post("/api/restaurant/password/forgot").send({ email: "gerant@ama.tg" }).expect(503);
    const unknown = await request(app).post("/api/restaurant/password/forgot").send({ email: "personne@ama.tg" }).expect(503);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.contactSupport).toBe(true);
  });

  it("mode test sans e-mail : le code est renvoyé à l'écran", async () => {
    const { app } = setup({ devCodes: true });
    const sent = await request(app).post("/api/restaurant/password/forgot").send({ email: "gerant@ama.tg" }).expect(200);
    expect(sent.body.devCode).toMatch(/^\d{6}$/);
  });
});
