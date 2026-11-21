import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { EmailSender } from "./email.js";

// Mot de passe oublié de l'équipe admin : code par e-mail, nouveau mot de passe, anciennes sessions fermées.
type Reset = { id: number; role: string; subject: string; codeHash: string; expiresAt: Date; createdAt: Date; attempts: number; consumedAt: Date | null };

function setup(opts: { email?: EmailSender; devCodes?: boolean } = {}) {
  const member = { id: "d1", name: "Rachade", email: "directeur@zedeka.tg", passwordHash: "!", role: "DIRECTOR", active: true, sessionsValidFrom: null as Date | null };
  const resets: Reset[] = [];
  const prisma = {
    teamMember: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => (where.id === member.id || where.email === member.email ? { ...member } : null),
      update: async ({ data }: { data: Partial<typeof member> }) => Object.assign(member, data),
    },
    passwordReset: {
      count: async ({ where }: { where: { subject: string } }) => resets.filter((r) => r.subject === where.subject).length,
      create: async ({ data }: { data: Omit<Reset, "id" | "createdAt" | "attempts" | "consumedAt"> }) => {
        const row = { id: resets.length + 1, createdAt: new Date(), attempts: 0, consumedAt: null, ...data };
        resets.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: { subject: string; role: string } }) =>
        resets.filter((r) => r.subject === where.subject && r.role === where.role && !r.consumedAt).sort((a, b) => b.id - a.id)[0] ?? null,
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
  return { app, member, resets };
}

describe("mot de passe oublié de l'équipe admin", () => {
  it("envoie un code par e-mail, change le mot de passe et ouvre la connexion", async () => {
    const mails: { to: string; subject: string; text: string }[] = [];
    const { app, member } = setup({ email: { send: async (to, subject, text) => void mails.push({ to, subject, text }) } });
    const sent = await request(app).post("/api/admin/password/forgot").send({ email: " Directeur@Zedeka.tg " }).expect(200);
    expect(sent.body.devCode).toBeUndefined();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("directeur@zedeka.tg");
    const code = /(\d{6})/.exec(mails[0].subject)![1];
    expect(mails[0].text).toContain(code);

    await request(app).post("/api/admin/password/reset").send({ email: "directeur@zedeka.tg", code, password: "court" }).expect(400);
    await request(app).post("/api/admin/password/reset").send({ email: "directeur@zedeka.tg", code: code === "000000" ? "111111" : "000000", password: "nouveau-mot-2026" }).expect(400);
    await request(app).post("/api/admin/password/reset").send({ email: "directeur@zedeka.tg", code, password: "nouveau-mot-2026" }).expect(200);
    expect(await bcrypt.compare("nouveau-mot-2026", member.passwordHash)).toBe(true);
    expect(member.sessionsValidFrom).toBeInstanceOf(Date);

    // Le code ne sert qu'une fois.
    await request(app).post("/api/admin/password/reset").send({ email: "directeur@zedeka.tg", code, password: "encore-autre-2026" }).expect(400);

    const login = await request(app).post("/api/admin/login").send({ email: "directeur@zedeka.tg", password: "nouveau-mot-2026" }).expect(200);
    expect(login.body.role).toBe("DIRECTOR");
    await request(app).get("/api/admin/me").set({ authorization: `Bearer ${login.body.token}` }).expect(200);
  });

  it("ferme les sessions ouvertes avant le changement de mot de passe", async () => {
    const { app, member } = setup({ devCodes: true });
    member.passwordHash = bcrypt.hashSync("ancien-mot-2026", 4);
    const old = await request(app).post("/api/admin/login").send({ email: "directeur@zedeka.tg", password: "ancien-mot-2026" }).expect(200);
    await new Promise((r) => setTimeout(r, 5));
    const sent = await request(app).post("/api/admin/password/forgot").send({ email: "directeur@zedeka.tg" }).expect(200);
    await request(app).post("/api/admin/password/reset").send({ email: "directeur@zedeka.tg", code: sent.body.devCode, password: "nouveau-mot-2026" }).expect(200);
    await request(app).get("/api/admin/me").set({ authorization: `Bearer ${old.body.token}` }).expect(401);
  });

  it("adresse inconnue ou compte désactivé : même réponse, aucun e-mail", async () => {
    const mails: string[] = [];
    const { app, member } = setup({ email: { send: async (to) => void mails.push(to) } });
    const unknown = await request(app).post("/api/admin/password/forgot").send({ email: "personne@zedeka.tg" }).expect(200);
    member.active = false;
    const inactive = await request(app).post("/api/admin/password/forgot").send({ email: "directeur@zedeka.tg" }).expect(200);
    expect(unknown.body).toEqual(inactive.body);
    expect(mails).toHaveLength(0);
  });

  it("sans service d'e-mail : refus clair, sans révéler si le compte existe", async () => {
    const { app } = setup();
    const known = await request(app).post("/api/admin/password/forgot").send({ email: "directeur@zedeka.tg" }).expect(503);
    const unknown = await request(app).post("/api/admin/password/forgot").send({ email: "personne@zedeka.tg" }).expect(503);
    expect(known.body).toEqual(unknown.body);
  });

  it("bloque après 5 codes faux", async () => {
    const { app } = setup({ devCodes: true });
    const sent = await request(app).post("/api/admin/password/forgot").send({ email: "directeur@zedeka.tg" }).expect(200);
    const wrong = sent.body.devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await request(app).post("/api/admin/password/reset").send({ email: "directeur@zedeka.tg", code: wrong, password: "nouveau-mot-2026" }).expect(400);
    await request(app).post("/api/admin/password/reset").send({ email: "directeur@zedeka.tg", code: sent.body.devCode, password: "nouveau-mot-2026" }).expect(429);
  });
});
