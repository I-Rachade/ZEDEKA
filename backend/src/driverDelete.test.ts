import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { CUSTOMER_TOKEN_TTL_MS, issueToken } from "./auth.js";
import { memoryStore } from "./storage.js";

type Row = Record<string, unknown> & { id: string };
const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

// Base en mémoire : livreurs, commandes, historique et dossier Zed, juste ce que la suppression consulte.
function setup() {
  const base = { status: "APPROVED", active: true, deletedAt: null, sessionsValidFrom: null };
  const drivers: Row[] = [
    { id: "neuf", name: "Nouveau", phone: "+228 90 00 00 01", email: null, ...base },
    { id: "ancien", name: "Mahmoude", phone: "+228 90 00 00 02", email: "m@zedeka.tg", pinHash: "x", online: true, plate: "TG-1234", zedAvailable: true, ...base },
    { id: "occupe", name: "Kodjo", phone: "+228 90 00 00 03", ...base },
    { id: "especes", name: "Afi", phone: "+228 90 00 00 04", ...base },
    { id: "zed", name: "Yao", phone: "+228 90 00 00 05", ...base },
  ];
  const orders: Row[] = [
    { id: "o1", driverId: "ancien", status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: "c1" },
    { id: "o2", driverId: "occupe", status: "PICKED_UP", paymentMethod: "MOBILE", cashCollectionId: null },
    { id: "o3", driverId: "especes", status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null },
  ];
  const rides: Row[] = [{ id: "r1", driverId: "zed", status: "ONBOARD" }];
  const locations: Row[] = [{ id: "l1", driverId: "ancien" }];
  const pushes: Row[] = [
    { id: "p1", role: "driver", subject: "ancien" },
    { id: "p2", role: "restaurant", subject: "ancien" },
  ];
  const documents: Row[] = [
    { id: "z1", driverId: "ancien", fileKey: "zed/ancien/selfie-1" },
    { id: "z2", driverId: "ancien", fileKey: "zed/ancien/id_card-1" },
    { id: "z3", driverId: "neuf", fileKey: "zed/neuf/selfie-1" },
  ];
  const offers: Row[] = [{ id: "of1", driverId: "ancien" }];
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "in" in v ? (v as { in: unknown[] }).in.includes(row[k]) : v && typeof v === "object" ? true : row[k] === v,
    );
  const removeWhere = (rows: Row[]) => async ({ where }: { where: Record<string, unknown> }) => {
    for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
    return { count: 0 };
  };
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
    zedRide: { count: async ({ where }: { where: Record<string, unknown> }) => rides.filter((r) => matches(r, where)).length },
    zedPayment: none,
    zedDocument: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => documents.filter((d) => matches(d, where)),
      deleteMany: removeWhere(documents),
    },
    zedOffer: { deleteMany: removeWhere(offers) },
    driverAssignment: none,
    cashCollection: { count: async ({ where }: { where: { driverId: string } }) => (where.driverId === "ancien" ? 1 : 0) },
    driverIssue: none,
    driverLocation: { deleteMany: removeWhere(locations) },
    pushSubscription: { deleteMany: removeWhere(pushes) },
  } as unknown as PrismaClient;
  const files = memoryStore();
  for (const d of documents) void files.put(d.fileKey as string, new Uint8Array([1]), "image/jpeg");
  const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", files, ...STRONG });
  return { app, drivers, locations, pushes, documents, offers, files };
}

async function director(app: ReturnType<typeof setup>["app"]) {
  const res = await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
  return { authorization: `Bearer ${res.body.token}` };
}
const driverToken = (id: string) => ({ authorization: `Bearer ${issueToken(STRONG.adminSecret, Date.now(), "driver", id, CUSTOMER_TOKEN_TTL_MS)}` });

describe("suppression d'un livreur", () => {
  it("efface un livreur sans aucune course, photos du dossier Zed comprises", async () => {
    const { app, drivers, files } = setup();
    const res = await request(app).delete("/api/admin/drivers/neuf").set(await director(app)).expect(200);
    expect(res.body).toEqual({ deleted: true, kept: false });
    expect(drivers.find((d) => d.id === "neuf")).toBeUndefined();
    expect(files.files.has("zed/neuf/selfie-1")).toBe(false);
  });

  it("garde le nom d'un livreur qui a des courses passées mais ferme son compte et efface ses coordonnées", async () => {
    const { app, drivers, locations, pushes, documents, offers, files } = setup();
    const res = await request(app).delete("/api/admin/drivers/ancien").set(await director(app)).expect(200);
    expect(res.body).toEqual({ deleted: true, kept: true });
    const d = drivers.find((x) => x.id === "ancien")!;
    expect(d.name).toBe("Mahmoude");
    expect(d.deletedAt).toBeInstanceOf(Date);
    expect(d).toMatchObject({ active: false, online: false, phone: "supprime-ancien", email: null, pinHash: null, plate: null, zedAvailable: false });
    expect(d.sessionsValidFrom).toBeInstanceOf(Date);
    expect(locations).toHaveLength(0);
    // Plus de notifications sur son téléphone ; celles d'un autre rôle restent.
    expect(pushes.map((p) => p.id)).toEqual(["p2"]);
    // Selfie et pièce d'identité du dossier Zed : lignes et fichiers effacés.
    expect(documents.map((x) => x.id)).toEqual(["z3"]);
    expect([...files.files.keys()]).toEqual(["zed/neuf/selfie-1"]);
    expect(offers).toHaveLength(0);
    // Déjà supprimé : introuvable.
    await request(app).delete("/api/admin/drivers/ancien").set(await director(app)).expect(404);
  });

  it("refuse tant qu'une course ou un Zed est en cours, ou que des espèces restent à remettre", async () => {
    const { app, drivers } = setup();
    const auth = await director(app);
    const busy = await request(app).delete("/api/admin/drivers/occupe").set(auth).expect(409);
    expect(busy.body.error).toMatch(/course en cours/);
    const zed = await request(app).delete("/api/admin/drivers/zed").set(auth).expect(409);
    expect(zed.body.error).toMatch(/course en cours/);
    const cash = await request(app).delete("/api/admin/drivers/especes").set(auth).expect(409);
    expect(cash.body.error).toMatch(/espèces/);
    expect(drivers).toHaveLength(5);
  });

  it("est réservée au directeur", async () => {
    const { app, drivers } = setup();
    const login = await request(app).post("/api/admin/login").send({ email: "koffi@zedeka.tg", password: "dispatch-2026" }).expect(200);
    await request(app).delete("/api/admin/drivers/neuf").set({ authorization: `Bearer ${login.body.token}` }).expect(403);
    expect(drivers).toHaveLength(5);
  });
});

describe("suppression de son compte depuis l'application livreur", () => {
  it("applique les mêmes règles et ferme la session", async () => {
    const { app, drivers } = setup();
    const busy = await request(app).delete("/api/livreur/me").set(driverToken("especes")).expect(409);
    expect(busy.body.error).toMatch(/espèces à remettre/);
    await request(app).delete("/api/livreur/me").set(driverToken("ancien")).expect(204);
    expect(drivers.find((d) => d.id === "ancien")).toMatchObject({ active: false, phone: "supprime-ancien" });
    // Compte fermé : le jeton ne passe plus.
    await request(app).delete("/api/livreur/me").set(driverToken("ancien")).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
  });
});
