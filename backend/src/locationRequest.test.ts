import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  ADDRESS_FROM_RECIPIENT,
  addressWithLandmark,
  hashLocationToken,
  isTokenShape,
  linkUsable,
  locationLink,
  locationStatus,
  newLocationToken,
} from "./locationRequest.js";

const now = new Date("2026-10-29T12:00:00Z");
const later = new Date("2026-10-30T12:00:00Z");
const earlier = new Date("2026-10-28T12:00:00Z");

describe("jeton du lien", () => {
  it("est aléatoire, de 22 caractères, et seule son empreinte est gardée", () => {
    const a = newLocationToken();
    const b = newLocationToken();
    expect(a).not.toBe(b);
    expect(isTokenShape(a)).toBe(true);
    expect(hashLocationToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLocationToken(a)).not.toContain(a);
  });
  it("refuse les formes inattendues avant d'interroger la base", () => {
    expect(isTokenShape("abc")).toBe(false);
    expect(isTokenShape("a".repeat(21) + "/")).toBe(false);
  });
});

describe("validité du lien", () => {
  it("se ferme à l'échéance, une fois le colis récupéré, ou après remplacement", () => {
    expect(linkUsable({ status: "OPENED", expiresAt: later }, "PENDING", now)).toBe(true);
    expect(linkUsable({ status: "SHARED", expiresAt: later }, "CONFIRMED", now)).toBe(true);
    expect(linkUsable({ status: "OPENED", expiresAt: earlier }, "PENDING", now)).toBe(false);
    expect(linkUsable({ status: "OPENED", expiresAt: later }, "PICKED_UP", now)).toBe(false);
    expect(linkUsable({ status: "EXPIRED", expiresAt: later }, "PENDING", now)).toBe(false);
  });
  it("donne à l'expéditeur un état simple", () => {
    expect(locationStatus(null, "PENDING", now)).toBeNull();
    expect(locationStatus({ status: "OPENED", expiresAt: later }, "PENDING", now)).toBe("PENDING");
    expect(locationStatus({ status: "OPENED", expiresAt: earlier }, "PENDING", now)).toBe("EXPIRED");
    expect(locationStatus({ status: "SHARED", expiresAt: earlier }, "DELIVERED", now)).toBe("SHARED");
    expect(locationStatus({ status: "DECLINED", expiresAt: later }, "PENDING", now)).toBe("DECLINED");
  });
});

describe("message pour le destinataire", () => {
  it("ne contient que les prénoms et le lien, adressé au numéro du destinataire", () => {
    const l = locationLink("https://zedeka.tg/", "T".repeat(22), { customerName: "Koffi Mensah", recipientName: "Ama Kossi", recipientPhone: "91 00 00 00" }, later);
    expect(l.url).toBe(`https://zedeka.tg/position/${"T".repeat(22)}`);
    expect(l.whatsappUrl.startsWith("https://wa.me/22891000000?text=")).toBe(true);
    const text = decodeURIComponent(l.whatsappUrl.split("text=")[1]);
    expect(text).toContain("Bonjour Ama, Koffi vous envoie un colis");
    expect(text).not.toContain("Mensah");
  });
  it("ajoute le repère à l'adresse sans l'empiler", () => {
    expect(addressWithLandmark(ADDRESS_FROM_RECIPIENT, "portail vert")).toBe("Repère : portail vert");
    expect(addressWithLandmark("Adidogomé, rond-point", "portail vert")).toBe("Adidogomé, rond-point · Repère : portail vert");
    expect(addressWithLandmark("Adidogomé · Repère : ancien", "nouveau")).toBe("Adidogomé · Repère : nouveau");
    expect(addressWithLandmark("Adidogomé", undefined)).toBe("Adidogomé");
  });
});

// Base simulée : une demande de position et sa commande.
function fakeDb(req: { status: string; expiresAt: Date }, orderStatus = "PENDING") {
  const token = newLocationToken();
  const state = {
    request: { id: "lr1", tokenHash: hashLocationToken(token), ...req, order: { id: "o1", code: "ZD-AAAA", status: orderStatus, customerName: "Koffi Mensah", address: ADDRESS_FROM_RECIPIENT, driverId: null } },
    orderUpdates: [] as Record<string, unknown>[],
    requestUpdates: [] as Record<string, unknown>[],
  };
  const prisma = {
    locationRequest: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => (where.tokenHash === state.request.tokenHash ? state.request : null),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.requestUpdates.push(data);
        return data;
      },
    },
    order: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.orderUpdates.push(data);
        return data;
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  return { prisma, token, state };
}

const appFor = (prisma: PrismaClient) => createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" });
const soon = () => new Date(Date.now() + 3600_000);

describe("page du destinataire", () => {
  it("ne montre que le prénom de l'expéditeur", async () => {
    const { prisma, token, state } = fakeDb({ status: "PENDING", expiresAt: soon() });
    const res = await request(appFor(prisma)).get(`/api/position/${token}`).expect(200);
    expect(res.body).toEqual({ senderFirstName: "Koffi", status: "OPENED", expiresAt: expect.any(String) });
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(state.requestUpdates[0]).toMatchObject({ status: "OPENED" });
  });

  it("répond pareil pour un lien inconnu, échu ou un colis déjà en route", async () => {
    const expired = fakeDb({ status: "OPENED", expiresAt: new Date(Date.now() - 1000) });
    const picked = fakeDb({ status: "OPENED", expiresAt: soon() }, "PICKED_UP");
    const unknown = await request(appFor(expired.prisma)).get(`/api/position/${newLocationToken()}`).expect(404);
    const a = await request(appFor(expired.prisma)).get(`/api/position/${expired.token}`).expect(404);
    const b = await request(appFor(picked.prisma)).post(`/api/position/${picked.token}`).send({ latitude: 6.13, longitude: 1.22, consent: true }).expect(404);
    expect(a.body).toEqual(unknown.body);
    expect(b.body).toEqual(unknown.body);
    expect(picked.state.orderUpdates).toHaveLength(0);
  });

  it("n'enregistre la position qu'avec l'accord, et la met sur la commande", async () => {
    const { prisma, token, state } = fakeDb({ status: "OPENED", expiresAt: soon() });
    await request(appFor(prisma)).post(`/api/position/${token}`).send({ latitude: 6.13, longitude: 1.22 }).expect(400);
    expect(state.orderUpdates).toHaveLength(0);
    await request(appFor(prisma)).post(`/api/position/${token}`).send({ latitude: 6.13, longitude: 1.22, accuracy: 12, landmark: "portail vert", consent: true }).expect(200);
    expect(state.orderUpdates[0]).toEqual({ latitude: 6.13, longitude: 1.22, locationSource: "RECIPIENT", address: "Repère : portail vert" });
    expect(state.requestUpdates[0]).toMatchObject({ status: "SHARED", accuracyM: 12, landmark: "portail vert", consentAt: expect.any(Date) });
  });

  it("garde le refus et le repère écrit", async () => {
    const { prisma, token, state } = fakeDb({ status: "OPENED", expiresAt: soon() });
    await request(appFor(prisma)).post(`/api/position/${token}/decline`).send({ landmark: "après la boutique" }).expect(200);
    expect(state.orderUpdates[0]).toEqual({ address: "Repère : après la boutique" });
    expect(state.requestUpdates[0]).toMatchObject({ status: "DECLINED", landmark: "après la boutique" });
  });
});

describe("nouveau lien depuis le suivi", () => {
  const order = { id: "o1", type: "PARCEL", status: "PENDING", customerId: null, customerName: "Koffi", customerPhone: "+22890112233", recipientName: "Ama", recipientPhone: "91000000" };
  function db(o = order) {
    const upserts: unknown[] = [];
    const prisma = {
      order: { findUnique: async () => o },
      locationRequest: {
        upsert: async (args: unknown) => {
          upserts.push(args);
          return {};
        },
      },
    } as unknown as PrismaClient;
    return { prisma, upserts };
  }

  it("exige le numéro de l'expéditeur, pas celui du destinataire", async () => {
    const { prisma, upserts } = db();
    await request(appFor(prisma)).post("/api/parcels/ZD-AAAA/location-link").send({ phone: "91 00 00 00" }).expect(404);
    expect(upserts).toHaveLength(0);
    const res = await request(appFor(prisma)).post("/api/parcels/ZD-AAAA/location-link").send({ phone: "90 11 22 33" }).expect(201);
    expect(res.body.url).toMatch(/^\/position\/[A-Za-z0-9_-]{22}$/);
    expect(upserts).toHaveLength(1);
  });

  it("refuse une fois le colis récupéré", async () => {
    const { prisma } = db({ ...order, status: "PICKED_UP" });
    await request(appFor(prisma)).post("/api/parcels/ZD-AAAA/location-link").send({ phone: "90112233" }).expect(409);
  });
});
