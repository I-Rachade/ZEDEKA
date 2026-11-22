import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { customerScore, deliveryTiming, driverScore, merchantScore, restaurantScore, segmentsFor } from "./crm.js";
import { staffMay } from "./team.js";

// Suivi CRM : scores sur 100, groupes, droits et routes de l'admin.
describe("scores du suivi CRM", () => {
  it("donne 100 à un livreur parfait et le fait tomber avec les refus, annulations et plaintes", () => {
    const perfect = driverScore({ ratingAvg: 5, ratingCount: 30, delivered: 40, cancelled: 0, offered: 40, accepted: 40, complaints: 0, warnings: 0, timed: 40, onTime: 40, avgTripMin: 18 });
    expect(perfect.value).toBe(100);
    const slow = driverScore({ ratingAvg: 5, ratingCount: 30, delivered: 40, cancelled: 0, offered: 40, accepted: 40, complaints: 0, warnings: 0, timed: 40, onTime: 10, avgTripMin: 45 });
    expect(slow.value).toBe(85);
    const bad = driverScore({ ratingAvg: 3.2, ratingCount: 18, delivered: 23, cancelled: 3, offered: 40, accepted: 23, complaints: 2, warnings: 2 });
    expect(bad.value).toBeLessThan(60);
    expect(bad.parts.map((p) => p.max)).toEqual([35, 15, 15, 20, 15]);
  });

  it("mesure le retrait, le trajet et le temps total d'une livraison", () => {
    const at = (min: number) => new Date(Date.UTC(2026, 10, 21, 12, min));
    // Accepté à 12:00, plat prêt à 12:10 (attente non comptée), retiré à 12:15, remis à 12:31 pour 4 km (prévu 22 min).
    const t = deliveryTiming({ acceptedAt: at(0), readyAt: at(10), pickedUpAt: at(15), handedOverAt: at(31), deliveredAt: at(50), distanceKm: 4 });
    expect(t).toEqual({ pickupMin: 5, tripMin: 16, totalMin: 31, expectedMin: 22, onTime: true });
    // Sans distance : 30 min prévues ; remise non déclarée : la livraison confirmée compte.
    expect(deliveryTiming({ acceptedAt: at(0), readyAt: null, pickedUpAt: at(10), handedOverAt: null, deliveredAt: at(50), distanceKm: null }).onTime).toBe(false);
    // Appli oubliée (plus de 4 h) : pas de mesure.
    expect(deliveryTiming({ acceptedAt: null, readyAt: null, pickedUpAt: at(0), handedOverAt: new Date(at(0).getTime() + 5 * 3_600_000), deliveredAt: null, distanceKm: 2 }).tripMin).toBeNull();
  });

  it("ne note pas une personne qui a trop peu d'activité", () => {
    expect(driverScore({ ratingAvg: null, ratingCount: 0, delivered: 1, cancelled: 0, offered: 2, accepted: 2, complaints: 0, warnings: 0 }).value).toBeNull();
    expect(customerScore({ orders: 2, delivered: 2, cancelled: 0, refusedAtDoor: 0, disputes: 0, complaints: 0, warnings: 0 }).value).toBeNull();
  });

  it("sanctionne un client qui refuse à la porte", () => {
    const good = customerScore({ orders: 10, delivered: 10, cancelled: 0, refusedAtDoor: 0, disputes: 0, complaints: 0, warnings: 0 });
    const door = customerScore({ orders: 10, delivered: 7, cancelled: 3, refusedAtDoor: 3, disputes: 0, complaints: 0, warnings: 0 });
    expect(good.value).toBe(100);
    expect(door.value!).toBeLessThan(good.value!);
  });

  it("compte la préparation à l'heure d'un commerce et l'activité d'un marchand", () => {
    const r = restaurantScore({ ratingAvg: 4, ratingCount: 10, received: 20, refused: 5, delivered: 15, timed: 10, onTime: 5, complaints: 0, warnings: 0 });
    expect(r.parts.find((p) => p.key === "prep")!.points).toBe(8);
    const m = merchantScore({ sent: 10, delivered: 10, cancelled: 0, sentLast30: 4, complaints: 0, warnings: 1 });
    expect(m.value).toBe(60 + 10 + 15);
  });

  it("range les clients en VIP, fidèles, nouveaux et endormis", () => {
    const now = Date.parse("2026-11-21T10:00:00Z");
    const ago = (d: number) => new Date(now - d * 86_400_000);
    expect(segmentsFor("CUSTOMER", { score: 90, createdAt: ago(100), lastActivityAt: ago(1), delivered30: 6, delivered60: 12, ordersAllTime: 30 }, now)).toEqual(["VIP"]);
    expect(segmentsFor("CUSTOMER", { score: 90, createdAt: ago(5), lastActivityAt: ago(1), delivered30: 3, delivered60: 3, ordersAllTime: 3 }, now)).toEqual(["LOYAL", "NEW"]);
    expect(segmentsFor("CUSTOMER", { score: 50, createdAt: ago(200), lastActivityAt: ago(40), ordersAllTime: 8 }, now)).toEqual(["WATCH", "DORMANT"]);
    expect(segmentsFor("DRIVER", { score: 92, createdAt: ago(200), lastActivityAt: ago(20) }, now)).toEqual(["TOP", "INACTIVE"]);
  });
});

describe("droits du suivi CRM", () => {
  it("ouvre le CRM aux managerins et à l'adjoint, pas au dispatcheur", () => {
    expect(staffMay("MANAGER", "POST", "/crm/driver/d1/notes")).toBe(true);
    expect(staffMay("DEPUTY", "POST", "/crm/tasks/t1")).toBe(true);
    expect(staffMay("DISPATCHER", "GET", "/crm/driver")).toBe(false);
  });
});

const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

function setup() {
  const now = Date.now();
  const ago = (d: number) => new Date(now - d * 86_400_000);
  const notes: Record<string, unknown>[] = [];
  const tasks: Record<string, unknown>[] = [];
  const driverOrders = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, code: `ZD-${i}`, driverId: "d1", status: "DELIVERED", driverRating: 5, deliveredAt: ago(i + 1), createdAt: ago(i + 1), cancelledAt: null, cancellationReason: null, ratingComment: null, restaurantRating: null, readyAt: null, pickedUpAt: new Date(ago(i + 1).getTime() - 15 * 60_000), handedOverAt: ago(i + 1), distanceKm: 3, assignments: [] })),
  ];
  const empty = async () => [];
  const prisma = {
    teamMember: { findUnique: async () => null, findMany: async () => [{ name: "Afi" }] },
    driver: {
      findMany: async ({ where }: { where: { id?: { in: string[] } } }) =>
        [
          { id: "d1", name: "Kossi", phone: "+22890000012", active: true, status: "APPROVED", employment: "STAFF", vehicle: "MOTO", createdAt: ago(200), lastSeenAt: ago(0), zone: { name: "Lomé" } },
          { id: "d2", name: "Edem", phone: "+22899000077", active: true, status: "APPROVED", employment: "FREELANCE", vehicle: "MOTO", createdAt: ago(10), lastSeenAt: null, zone: null },
        ].filter((d) => !where.id || where.id.in.includes(d.id)),
    },
    order: {
      findMany: async ({ where }: { where: { driverId?: unknown } }) => (where.driverId !== undefined ? driverOrders : []),
      groupBy: empty,
    },
    driverAssignment: { findMany: async ({ where }: { where: { status: { in: string[] } } }) => (where.status.in.includes("ACCEPTED") ? driverOrders.map(() => ({ driverId: "d1", status: "ACCEPTED" })) : []) },
    driverIssue: { findMany: empty },
    supportRequest: { findMany: empty },
    crmNote: {
      findMany: async ({ where }: { where: { kind?: string } }) => notes.filter((n) => !where.kind || n.kind === where.kind),
      create: async ({ data }: { data: Record<string, unknown> }) => (notes.push({ id: `n${notes.length}`, createdAt: new Date(), ...data }), notes.at(-1)),
    },
    crmTag: { findMany: empty, findFirst: async () => null, create: async ({ data }: { data: unknown }) => data },
    crmTask: {
      findMany: async () => tasks,
      create: async ({ data }: { data: Record<string, unknown> }) => (tasks.push({ id: `t${tasks.length}`, ...data }), tasks.at(-1)),
    },
  } as unknown as PrismaClient;
  return { app: createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG }), notes, tasks };
}

async function login(app: ReturnType<typeof setup>["app"]) {
  const res = await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200);
  return { authorization: `Bearer ${res.body.token}` };
}

describe("routes du suivi CRM", () => {
  it("liste les livreurs avec leur score, ouvre une fiche et y ajoute une note et un rappel", async () => {
    const { app, notes, tasks } = setup();
    const auth = await login(app);
    const list = await request(app).get("/api/admin/crm/driver").set(auth).expect(200);
    expect(list.body.rows.map((r: { id: string }) => r.id)).toEqual(["d1", "d2"]);
    expect(list.body.rows[0].score).toBe(100);
    expect(list.body.rows[0].cols).toMatchObject({ time: "15 min", ontime: "100 %" });
    expect(list.body.rows[1].score).toBeNull();
    expect(list.body.counts.NEW).toBe(1);

    const profile = await request(app).get("/api/admin/crm/driver/d1").set(auth).expect(200);
    expect(profile.body.name).toBe("Kossi");
    expect(profile.body.timeline.length).toBe(6);
    expect(profile.body.score.parts).toHaveLength(5);
    expect(profile.body.timeline[0].text).toContain("trajet 15 min, à l'heure");

    await request(app).post("/api/admin/crm/driver/d1/notes").set(auth).send({ kind: "WARNING", body: "Retards répétés" }).expect(201);
    expect(notes[0]).toMatchObject({ entityType: "DRIVER", entityId: "d1", kind: "WARNING" });
    await request(app).post("/api/admin/crm/driver/d1/tasks").set(auth).send({ title: "Rappeler lundi", dueAt: "2026-11-24", assignedTo: "Afi" }).expect(201);
    expect(tasks[0]).toMatchObject({ entityName: "Kossi", assignedTo: "Afi" });

    await request(app).get("/api/admin/crm/driver/inconnu").set(auth).expect(404);
    await request(app).post("/api/admin/crm/driver/inconnu/notes").set(auth).send({ body: "x" }).expect(404);
    await request(app).get("/api/admin/crm/autre").set(auth).expect(404);
  });
});
