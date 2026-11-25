import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { invalidateServices, moduleOn, publicServices } from "./services.js";

const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

type Row = { code: string; state: string; sortOrder: number; updatedBy?: string | null; basePrice?: number | null; unitPrice?: number | null };

// Faux Prisma : modules, réglages (Mode Zed) et compte d'équipe.
function fakePrisma(role = "DIRECTOR") {
  const rows: Row[] = [];
  const settings = { id: 1, zedEnabled: false, zedButtonColor: "SUN" };
  let reads = 0;
  const prisma = {
    serviceModule: {
      findMany: async () => {
        reads++;
        return rows.map((r) => ({ ...r }));
      },
      upsert: async ({ where, update, create }: { where: { code: string }; update: Partial<Row>; create: Row }) => {
        const row = rows.find((r) => r.code === where.code);
        if (row) return Object.assign(row, update);
        rows.push({ ...create });
        return create;
      },
    },
    settings: {
      findFirst: async () => settings,
      update: async ({ data }: { data: Partial<typeof settings> }) => Object.assign(settings, data),
    },
    teamMember: { findUnique: async () => ({ id: "m1", name: "Ama", role, active: true }) },
  } as unknown as PrismaClient;
  return { prisma, rows, settings, reads: () => reads };
}

const app = (prisma: PrismaClient) => createApp(prisma, { frontendOrigin: "https://zedeka.example", zedekaWhatsapp: "", ...STRONG });
const login = async (a: ReturnType<typeof app>) => `Bearer ${(await request(a).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200)).body.token}`;

describe("modules du bouton Services", () => {
  beforeEach(() => invalidateServices());

  it("par défaut : colis ouvert, course Zed selon le Mode Zed, services pas encore construits cachés", async () => {
    const { prisma, settings } = fakePrisma();
    const res = await request(app(prisma)).get("/api/services").expect(200);
    expect(res.body.modules.map((m: { code: string }) => m.code)).toEqual(["PARCEL"]);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers.etag).toBeTruthy();

    settings.zedEnabled = true;
    invalidateServices();
    const again = await request(app(prisma)).get("/api/services").expect(200);
    expect(again.body.modules.map((m: { code: string; state: string }) => `${m.code}:${m.state}`)).toEqual(["PARCEL:ON", "RIDE:ON"]);
  });

  it("le directeur annonce la lessive (« Bientôt ») : tuile visible mais pas cliquable, puis l'ouvre avec son tarif", async () => {
    const { prisma } = fakePrisma();
    const a = app(prisma);
    const auth = await login(a);
    const soon = await request(a).patch("/api/admin/services/LAUNDRY").set("authorization", auth).send({ state: "SOON" }).expect(200);
    expect(soon.body.state).toBe("SOON");
    const res = await request(a).get("/api/services").expect(200);
    const laundry = res.body.modules.find((m: { code: string }) => m.code === "LAUNDRY");
    // Annoncé mais pas cliquable.
    expect(laundry).toMatchObject({ state: "SOON", href: null });
    await request(a).patch("/api/admin/services/LAUNDRY").set("authorization", auth).send({ state: "ON", unitPrice: 3000 }).expect(200);
    invalidateServices();
    const open = (await request(a).get("/api/services").expect(200)).body.modules.find((m: { code: string }) => m.code === "LAUNDRY");
    expect(open).toMatchObject({ state: "ON", href: "/app/services/LAUNDRY", price: { base: 500, unit: 3000, unitLabel: "sac" } });
    // Le colis n'a pas de tarif ici ; un code inconnu n'existe pas.
    await request(a).patch("/api/admin/services/PARCEL").set("authorization", auth).send({ basePrice: 100 }).expect(400);
    await request(a).patch("/api/admin/services/INCONNU").set("authorization", auth).send({ state: "OFF" }).expect(404);
  });

  it("couper le colis le retire de la feuille et l'API refuse les nouveaux colis", async () => {
    const { prisma } = fakePrisma();
    const a = app(prisma);
    const auth = await login(a);
    expect(await moduleOn(prisma, "PARCEL")).toBe(true);
    await request(a).patch("/api/admin/services/PARCEL").set("authorization", auth).send({ state: "OFF" }).expect(200);
    expect(await moduleOn(prisma, "PARCEL")).toBe(false);
    const res = await request(a).get("/api/services").expect(200);
    expect(res.body.modules).toEqual([]);
  });

  it("la course Zed suit le Mode Zed des réglages dans les deux sens", async () => {
    const { prisma, settings } = fakePrisma();
    const a = app(prisma);
    const auth = await login(a);
    await request(a).patch("/api/admin/services/RIDE").set("authorization", auth).send({ state: "ON" }).expect(200);
    expect(settings.zedEnabled).toBe(true);
    await request(a).patch("/api/admin/services/RIDE").set("authorization", auth).send({ state: "OFF" }).expect(200);
    expect(settings.zedEnabled).toBe(false);
  });

  it("l'ordre choisi est celui de la feuille", async () => {
    const { prisma } = fakePrisma();
    const a = app(prisma);
    const auth = await login(a);
    await request(a).patch("/api/admin/services/ERRAND").set("authorization", auth).send({ state: "SOON" }).expect(200);
    await request(a).put("/api/admin/services/order").set("authorization", auth).send({ codes: ["ERRAND", "PARCEL"] }).expect(200);
    const res = await request(a).get("/api/services").expect(200);
    expect(res.body.modules.map((m: { code: string }) => m.code)).toEqual(["ERRAND", "PARCEL"]);
    await request(a).put("/api/admin/services/order").set("authorization", auth).send({ codes: ["PAS_UN_CODE"] }).expect(400);
  });

  it("réponse en cache : une lecture de la base pour beaucoup de clients, et 304 quand rien n'a changé", async () => {
    const { prisma, reads } = fakePrisma();
    const a = app(prisma);
    const first = await request(a).get("/api/services").expect(200);
    for (let i = 0; i < 20; i++) await request(a).get("/api/services").expect(200);
    expect(reads()).toBe(1);
    await request(a).get("/api/services").set("if-none-match", first.headers.etag).expect(304);
    // Après 30 secondes, une nouvelle lecture.
    await publicServices(prisma, Date.now() + 31_000);
    expect(reads()).toBe(2);
  });

  it("seul le directeur change les modules ; un dispatcheur ne les voit même pas", async () => {
    const { prisma } = fakePrisma("DISPATCHER");
    const a = app(prisma);
    const staff = (await request(a).post("/api/admin/login").send({ email: "ama@zedeka.example", password: "x" })).status;
    expect(staff).not.toBe(200);
    // Jeton d'un membre dispatcheur : on le fabrique avec la même clé que l'API.
    const { issueToken } = await import("./auth.js");
    const auth = `Bearer ${issueToken(STRONG.adminSecret, Date.now(), "admin", "m1")}`;
    await request(a).get("/api/admin/services").set("authorization", auth).expect(403);
    await request(a).patch("/api/admin/services/PARCEL").set("authorization", auth).send({ state: "OFF" }).expect(403);
  });
});
