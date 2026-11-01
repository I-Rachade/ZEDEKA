import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

type Row = Record<string, unknown> & { id: string };
const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

// Base en mémoire : livreurs, commandes et historique, juste ce que la suppression consulte.
function setup() {
  const drivers: Row[] = [
    { id: "neuf", name: "Nouveau", phone: "+228 90 00 00 01", email: null, active: true, deletedAt: null },
    { id: "ancien", name: "Mahmoude", phone: "+228 90 00 00 02", email: "m@zedeka.tg", pinHash: "x", active: true, online: true, deletedAt: null },
    { id: "occupe", name: "Kodjo", phone: "+228 90 00 00 03", active: true, deletedAt: null },
    { id: "especes", name: "Afi", phone: "+228 90 00 00 04", active: true, deletedAt: null },
  ];
  const orders: Row[] = [
    { id: "o1", driverId: "ancien", status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: "c1" },
    { id: "o2", driverId: "occupe", status: "PICKED_UP", paymentMethod: "MOBILE", cashCollectionId: null },
    { id: "o3", driverId: "especes", status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null },
  ];
  const locations: Row[] = [{ id: "l1", driverId: "ancien" }];
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "in" in v ? (v as { in: unknown[] }).in.includes(row[k]) : row[k] === v,
    );
  const none = { count: async () => 0 };
  const prisma = {
    teamMember: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        where.email === "koffi@zedeka.tg" || where.id === "m1"
          ? { id: "m1", name: "Koffi", email: "koffi@zedeka.tg", passwordHash: bcrypt.hashSync("dispatch-2026", 4), role: "DISPATCHER", active: true }
          : null,
      update: async () => ({}),
    },
    driver: {
      findUnique: async ({ where }: { where: { id: string } }) => drivers.find((d) => d.id === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => drivers.splice(drivers.findIndex((d) => d.id === where.id), 1)[0],
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(drivers.find((d) => d.id === where.id)!, data),
    },
    order: { count: async ({ where }: { where: Record<string, unknown> }) => orders.filter((o) => matches(o, where)).length },
    driverAssignment: none,
    cashCollection: { count: async ({ where }: { where: { driverId: string } }) => (where.driverId === "ancien" ? 1 : 0) },
    driverIssue: none,
    driverLocation: {
      deleteMany: async ({ where }: { where: { driverId: string } }) => {
        for (let i = locations.length - 1; i >= 0; i--) if (locations[i].driverId === where.driverId) locations.splice(i, 1);
      },
    },
  } as unknown as PrismaClient;
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });
  return { app, drivers, locations };
}

async function director(app: ReturnType<typeof setup>["app"]) {
  const res = await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
  return { authorization: `Bearer ${res.body.token}` };
}

describe("suppression d'un livreur", () => {
  it("efface un livreur sans aucune course", async () => {
    const { app, drivers } = setup();
    const res = await request(app).delete("/api/admin/drivers/neuf").set(await director(app)).expect(200);
    expect(res.body).toEqual({ deleted: true, kept: false });
    expect(drivers.find((d) => d.id === "neuf")).toBeUndefined();
  });

  it("garde le nom d'un livreur qui a des courses passées mais ferme son compte et efface ses coordonnées", async () => {
    const { app, drivers, locations } = setup();
    const res = await request(app).delete("/api/admin/drivers/ancien").set(await director(app)).expect(200);
    expect(res.body).toEqual({ deleted: true, kept: true });
    const d = drivers.find((x) => x.id === "ancien")!;
    expect(d.name).toBe("Mahmoude");
    expect(d.deletedAt).toBeInstanceOf(Date);
    expect(d).toMatchObject({ active: false, online: false, phone: "supprime-ancien", email: null, pinHash: null });
    expect(d.sessionsValidFrom).toBeInstanceOf(Date);
    expect(locations).toHaveLength(0);
    // Déjà supprimé : introuvable.
    await request(app).delete("/api/admin/drivers/ancien").set(await director(app)).expect(404);
  });

  it("refuse tant qu'une course est en cours ou que des espèces restent à remettre", async () => {
    const { app, drivers } = setup();
    const auth = await director(app);
    const busy = await request(app).delete("/api/admin/drivers/occupe").set(auth).expect(409);
    expect(busy.body.error).toMatch(/course en cours/);
    const cash = await request(app).delete("/api/admin/drivers/especes").set(auth).expect(409);
    expect(cash.body.error).toMatch(/espèces/);
    expect(drivers).toHaveLength(4);
  });

  it("est réservée au directeur", async () => {
    const { app, drivers } = setup();
    const login = await request(app).post("/api/admin/login").send({ email: "koffi@zedeka.tg", password: "dispatch-2026" }).expect(200);
    await request(app).delete("/api/admin/drivers/neuf").set({ authorization: `Bearer ${login.body.token}` }).expect(403);
    expect(drivers).toHaveLength(4);
  });
});
