import type { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Notifier } from "./notify.js";
import { adminManualRouter } from "./routes/adminManual.js";
import { staffMay } from "./team.js";

// Saisie au back-office d'une demande reçue par téléphone ou WhatsApp : course Zed, colis, livraison de repas.

const notifier = { push: async () => true, staff: async () => {} } as unknown as Notifier;

type Row = Record<string, unknown>;

function fakePrisma(opts: { zedEnabled?: boolean; customers?: Row[]; rides?: Row[] } = {}) {
  const customers: Row[] = opts.customers ?? [];
  const rides: Row[] = opts.rides ?? [];
  const orders: Row[] = [];
  const settings = { id: 1, zedEnabled: opts.zedEnabled ?? true, mobileMoneyEnabled: false, zedMinFee: 300, zedPerKmFee: 100, zedMaxOffers: 5, zedOfferSeconds: 15, zedRadiusM: 1000, zedFarRadiusM: 3000, parcelMinFee: 500, parcelPerKmFee: 100, parcelMaxFee: 0, parcelPricingMode: "KM" };
  const prisma = {
    settings: { findUnique: async () => settings, upsert: async () => settings, findFirst: async () => settings },
    serviceModule: { findUnique: async () => null, findMany: async () => [] },
    customer: {
      findUnique: async ({ where }: { where: { phone: string } }) => customers.find((c) => c.phone === where.phone) ?? null,
      findFirst: async ({ where }: { where: { phone: string } }) => customers.find((c) => c.phone === where.phone && !c.deletedAt) ?? null,
      create: async ({ data }: { data: Row }) => {
        const c = { id: `c${customers.length + 1}`, deletedAt: null, ...data };
        customers.push(c);
        return c;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(customers.find((c) => c.id === where.id)!, data),
    },
    zedRide: {
      count: async () => 0,
      findFirst: async ({ where }: { where: { customerId: string } }) => rides.find((r) => r.customerId === where.customerId && ["SEARCHING", "ACCEPTED", "ONBOARD"].includes(String(r.status))) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => rides.find((r) => r.id === where.id) ?? null,
      create: async ({ data }: { data: Row }) => {
        const r = { id: `r${rides.length + 1}`, status: "SEARCHING", offers: [], ...data };
        rides.push(r);
        return r;
      },
      updateMany: async () => ({ count: 1 }),
    },
    zedOffer: { count: async () => 0 },
    driver: { findMany: async () => [] },
    parcelCategory: { findFirst: async () => ({ id: "cat", name: "Documents", surcharge: 0, perKgFee: 0 }) },
    zone: { findMany: async () => [], findUnique: async () => null, upsert: async () => ({}) },
    order: {
      create: async ({ data }: { data: Row }) => {
        const o = { id: `o${orders.length + 1}`, ...data };
        orders.push(o);
        return o;
      },
    },
    customers,
    rides,
    orders,
  };
  return prisma;
}

function app(prisma: ReturnType<typeof fakePrisma>, staff = { id: "m1", name: "Afi", role: "DISPATCHER" }) {
  const a = express();
  a.use(express.json());
  a.use((_req, res, next) => {
    res.locals.staff = staff;
    next();
  });
  a.use(adminManualRouter(prisma as unknown as PrismaClient, { notifier, frontendOrigin: "https://zedeka.test" }));
  return a;
}

const ride = { channel: "PHONE", customerName: "Kossi Mensah", customerPhone: "90 12 34 56", latitude: 6.1319, longitude: 1.2228, landmark: "Devant la pharmacie" };

describe("accès à la saisie manuelle", () => {
  it("ouverte au directeur, à l'adjoint, à la managerin et au dispatcheur ; fermée aux RH et à la comptable", () => {
    for (const role of ["DIRECTOR", "DEPUTY", "MANAGER", "DISPATCHER"] as const) {
      expect(staffMay(role, "POST", "/orders/manual/ride")).toBe(true);
      expect(staffMay(role, "GET", "/orders/manual/options")).toBe(true);
    }
    for (const role of ["HR", "ACCOUNTANT"] as const) expect(staffMay(role, "POST", "/orders/manual/parcel")).toBe(false);
  });
});

describe("course Zed saisie au bureau", () => {
  it("crée le client par son numéro et garde le canal et la personne qui a saisi", async () => {
    const prisma = fakePrisma();
    const res = await request(app(prisma)).post("/orders/manual/ride").send(ride);
    expect(res.status).toBe(201);
    expect(prisma.customers).toEqual([expect.objectContaining({ phone: "+22890123456", name: "Kossi Mensah" })]);
    expect(prisma.rides[0]).toMatchObject({ source: "PHONE", createdBy: "Afi", mode: "CALL", customerId: "c1", landmark: "Devant la pharmacie" });
    expect(res.body.message.whatsappUrl).toMatch(/^https:\/\/wa\.me\/22890123456\?text=/);
  });

  it("reprend le compte existant et refuse une seconde course en cours", async () => {
    const prisma = fakePrisma({ customers: [{ id: "c9", phone: "+22890123456", name: "Kossi", deletedAt: null }], rides: [{ id: "r0", code: "ZR-OLD", customerId: "c9", status: "ACCEPTED" }] });
    const res = await request(app(prisma)).post("/orders/manual/ride").send({ ...ride, channel: "WHATSAPP" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("ZR-OLD");
    expect(prisma.customers).toHaveLength(1);
  });

  it("demande le canal, un numéro du Togo et un service Zed ouvert", async () => {
    expect((await request(app(fakePrisma())).post("/orders/manual/ride").send({ ...ride, channel: undefined })).status).toBe(400);
    expect((await request(app(fakePrisma())).post("/orders/manual/ride").send({ ...ride, customerPhone: "+33 6 12 34 56 78" })).status).toBe(400);
    expect((await request(app(fakePrisma({ zedEnabled: false }))).post("/orders/manual/ride").send(ride)).status).toBe(409);
  });

  it("l'aperçu ne crée rien", async () => {
    const prisma = fakePrisma();
    const res = await request(app(prisma)).post("/orders/manual/ride").send({ ...ride, preview: true });
    expect(res.status).toBe(200);
    expect(res.body.price).toBeNull();
    expect(prisma.rides).toHaveLength(0);
    expect(prisma.customers).toHaveLength(0);
  });
});

describe("colis saisi au bureau", () => {
  const parcel = {
    channel: "WHATSAPP",
    customerName: "Ama Boutique",
    customerPhone: "91 00 00 01",
    pickupAddress: "Marché de Bè, boutique 12",
    address: "Agoè, près de l'église",
    recipientName: "Yao",
    recipientPhone: "92 00 00 02",
    parcelCategoryId: "cat",
    weightKg: 2,
  };

  it("crée un colis en attente, avec son canal et son auteur", async () => {
    const prisma = fakePrisma();
    const res = await request(app(prisma, { id: null as unknown as string, name: "Directeur des opérations", role: "DIRECTOR" })).post("/orders/manual/parcel").send(parcel);
    expect(res.status).toBe(201);
    expect(prisma.orders[0]).toMatchObject({ type: "PARCEL", source: "WHATSAPP", createdBy: "Directeur des opérations", customerName: "Ama Boutique", recipientName: "Yao", total: 500 });
    expect(res.body.message.text).toContain("/commande/");
  });

  it("demande une adresse de retrait et de livraison", async () => {
    const res = await request(app(fakePrisma())).post("/orders/manual/parcel").send({ ...parcel, address: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("livraison");
  });
});
