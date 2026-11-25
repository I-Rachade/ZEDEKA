import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

type Row = Record<string, unknown> & { id: string };
const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

function setup() {
  const members: Row[] = [
    { id: "dir", name: "Rachade", email: "dir@zedeka.tg", passwordHash: bcrypt.hashSync("directeur-2026", 4), role: "DIRECTOR", active: true },
    { id: "ancien", name: "Ama", email: "ama@zedeka.tg", passwordHash: "x", role: "DISPATCHER", active: false },
    { id: "adj", name: "Esi", email: "esi@zedeka.tg", passwordHash: bcrypt.hashSync("adjointe-2026", 4), role: "DEPUTY", active: true },
  ];
  const pushes: Row[] = [{ id: "p1", role: "admin", subject: "ancien" }, { id: "p2", role: "admin", subject: "dir" }];
  const prefs: Row[] = [{ id: "ancien", subject: "ancien" }];
  const removeWhere = (rows: Row[]) => async ({ where }: { where: Record<string, unknown> }) => {
    for (let i = rows.length - 1; i >= 0; i--) if (Object.entries(where).every(([k, v]) => rows[i][k] === v)) rows.splice(i, 1);
    return { count: 0 };
  };
  const prisma = {
    teamMember: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => members.find((m) => m.id === where.id || m.email === where.email) ?? null,
      update: async () => ({}),
      delete: removeWhere(members),
    },
    pushSubscription: { deleteMany: removeWhere(pushes) },
    staffNotificationPrefs: { deleteMany: removeWhere(prefs) },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });
  return { app, members, pushes, prefs };
}

const login = async (app: ReturnType<typeof setup>["app"], body: Record<string, string>) => {
  const res = await request(app).post("/api/admin/login").send(body).expect(200);
  return { authorization: `Bearer ${res.body.token}` };
};

describe("suppression d'un membre de l'équipe", () => {
  it("efface le compte, ses réglages et ses abonnements aux notifications", async () => {
    const { app, members, pushes, prefs } = setup();
    await request(app).delete("/api/admin/team/ancien").set(await login(app, { password: STRONG.adminPassword })).expect(204);
    expect(members.map((m) => m.id)).toEqual(["dir", "adj"]);
    expect(pushes.map((p) => p.id)).toEqual(["p2"]);
    expect(prefs).toHaveLength(0);
  });

  it("refuse de supprimer son propre compte, et reste fermée à l'adjoint", async () => {
    const { app, members } = setup();
    const self = await request(app).delete("/api/admin/team/dir").set(await login(app, { email: "dir@zedeka.tg", password: "directeur-2026" })).expect(409);
    expect(self.body.error).toMatch(/propre compte/);
    await request(app).delete("/api/admin/team/ancien").set(await login(app, { email: "esi@zedeka.tg", password: "adjointe-2026" })).expect(403);
    expect(members).toHaveLength(3);
  });
});
