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
import { parseMapsLink, resolveMapsLink } from "./mapsLink.js";

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

// Colis au km : retrait à Bè, 1 000 FCFA minimum, 250 FCFA/km, supplément colis 500 FCFA.
const priced = {
  pickupLatitude: 6.1319,
  pickupLongitude: 1.2386,
  subtotal: 0,
  discount: 0,
  extraFee: 500,
  deliveryFee: 1500,
};
// Tarif des colis, dans les réglages.
const settings = { upsert: async () => ({ id: 1, parcelMinFee: 1000, parcelPerKmFee: 250, parcelMaxFee: 3000 }) };
// Zones avec leur centre : Adidogomé à l'ouest, Bè à l'est. La zone d'un point est celle du centre le plus proche.
const zoneList = [
  { id: "z-adidogome", name: "Adidogomé", latitude: 6.15, longitude: 1.2 },
  { id: "z-be", name: "Bè", latitude: 6.13, longitude: 1.24 },
];
const geo = {
  zone: {
    findMany: async () => zoneList,
    findUnique: async ({ where }: { where: { id: string } }) => zoneList.find((z) => z.id === where.id) ?? null,
    upsert: async () => ({ id: "parcels" }),
  },
  restaurant: { findMany: async () => [] },
};

// Base simulée : une demande de position et sa commande.
function fakeDb(req: { status: string; expiresAt: Date }, orderStatus = "PENDING") {
  const token = newLocationToken();
  const state = {
    request: { id: "lr1", tokenHash: hashLocationToken(token), ...req, order: { id: "o1", code: "ZD-AAAA", status: orderStatus, customerName: "Koffi Mensah", address: ADDRESS_FROM_RECIPIENT, driverId: null, ...priced } },
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
    settings,
    ...geo,
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
    await request(appFor(prisma)).post(`/api/position/${token}`).send({ latitude: 6.1475, longitude: 1.2125, accuracy: 12, landmark: "portail vert", consent: true }).expect(200);
    // 3,4 km depuis le retrait : 3,4 × 250 = 850, relevé au minimum de 1 000 ; + 500 de supplément.
    expect(state.orderUpdates[0]).toEqual({ latitude: 6.1475, longitude: 1.2125, locationSource: "RECIPIENT", distanceKm: 3.4, deliveryFee: 1000, total: 1500, zoneId: "z-adidogome", address: "Repère : portail vert" });
    expect(state.requestUpdates[0]).toMatchObject({ status: "SHARED", accuracyM: 12, landmark: "portail vert", consentAt: expect.any(Date) });
  });

  it("garde le refus et le repère écrit", async () => {
    const { prisma, token, state } = fakeDb({ status: "OPENED", expiresAt: soon() });
    await request(appFor(prisma)).post(`/api/position/${token}/decline`).send({ landmark: "après la boutique" }).expect(200);
    expect(state.orderUpdates[0]).toEqual({ address: "Repère : après la boutique" });
    expect(state.requestUpdates[0]).toMatchObject({ status: "DECLINED", landmark: "après la boutique" });
  });

  it("refuse un nouvel envoi ou un refus une fois la position reçue", async () => {
    const { prisma, token, state } = fakeDb({ status: "SHARED", expiresAt: soon() });
    expect((await request(appFor(prisma)).get(`/api/position/${token}`).expect(200)).body).toMatchObject({ status: "SHARED" });
    const a = await request(appFor(prisma)).post(`/api/position/${token}`).send({ latitude: 6.13, longitude: 1.22, consent: true }).expect(409);
    await request(appFor(prisma)).post(`/api/position/${token}/decline`).send({ landmark: "ailleurs" }).expect(409);
    expect(a.body.error).toContain("déjà été reçue");
    expect(state.orderUpdates).toHaveLength(0);
    expect(state.requestUpdates).toHaveLength(0);
  });
});

describe("nouveau lien depuis le suivi", () => {
  const order = { id: "o1", code: "ZD-AAAA", type: "PARCEL", status: "PENDING", driverId: null, customerId: null, customerName: "Koffi", customerPhone: "+22890112233", recipientName: "Ama", recipientPhone: "91000000", ...priced };
  function db(o = order) {
    const upserts: unknown[] = [];
    const updates: unknown[] = [];
    const prisma = {
      order: {
        findUnique: async () => o,
        update: async (args: { data: unknown }) => {
          updates.push(args.data);
          return {};
        },
      },
      locationRequest: {
        upsert: async (args: unknown) => {
          upserts.push(args);
          return {};
        },
        updateMany: async () => ({ count: 1 }),
      },
      settings,
      ...geo,
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    } as unknown as PrismaClient;
    return { prisma, upserts, updates };
  }

  it("exige le numéro de l'expéditeur, pas celui du destinataire", async () => {
    const { prisma, upserts } = db();
    await request(appFor(prisma)).post("/api/parcels/ZD-AAAA/location-link").send({ phone: "91 00 00 00" }).expect(404);
    expect(upserts).toHaveLength(0);
    const res = await request(appFor(prisma)).post("/api/parcels/ZD-AAAA/location-link").send({ phone: "90 11 22 33" }).expect(201);
    expect(res.body.url).toMatch(/^\/position\/[A-Za-z0-9_-]{22}$/);
    expect(upserts).toHaveLength(1);
  });

  it("refuse une fois le colis confié à un livreur", async () => {
    const { prisma } = db({ ...order, status: "CONFIRMED" });
    await request(appFor(prisma)).post("/api/parcels/ZD-AAAA/location-link").send({ phone: "90112233" }).expect(409);
  });

  it("laisse l'expéditeur placer le point lui-même, et fixe le prix", async () => {
    const { prisma, updates } = db();
    await request(appFor(prisma)).post("/api/parcels/ZD-AAAA/delivery-point").send({ phone: "91000000", latitude: 6.1475, longitude: 1.2125 }).expect(404);
    const res = await request(appFor(prisma)).post("/api/parcels/ZD-AAAA/delivery-point").send({ phone: "90112233", latitude: 6.1475, longitude: 1.2125 }).expect(200);
    expect(res.body).toEqual({ deliveryFee: 1000, total: 1500, distanceKm: 3.4 });
    expect(updates[0]).toMatchObject({ locationSource: "SENDER", deliveryFee: 1000, zoneId: "z-adidogome" });
  });
});

// Base simulée pour le parcours du formulaire : demande créée avant la commande, puis commande.
function formDb() {
  const state = {
    requests: [] as Record<string, unknown>[],
    orders: [] as Record<string, unknown>[],
    requestUpdates: [] as Record<string, unknown>[],
  };
  const match = (r: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (k === "expiresAt" ? (r.expiresAt as Date) > (v as { gt: Date }).gt : r[k] === v));
  const prisma = {
    locationRequest: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `lr${state.requests.length + 1}`, status: "PENDING", orderId: null, order: null, latitude: null, longitude: null, landmark: null, ...data };
        state.requests.push(r);
        return r;
      },
      findUnique: async ({ where }: { where: Record<string, unknown> }) => state.requests.find((r) => match(r, where)) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => state.requests.find((r) => match(r, where)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.requestUpdates.push(data);
        const r = state.requests.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    parcelCategory: { findFirst: async () => ({ id: "cat", name: "Documents", surcharge: 500, perKgFee: 0 }) },
    ...geo,
    order: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const o = { id: `o${state.orders.length + 1}`, ...data };
        state.orders.push(o);
        return o;
      },
    },
    settings,
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  return { prisma, state };
}

const parcel = {
  customerName: "Koffi Mensah",
  customerPhone: "90112233",
  paymentMethod: "CASH",
  recipientName: "Ama",
  recipientPhone: "91000000",
  parcelCategoryId: "cat",
  weightKg: 0.5,
};

describe("demande de position avant la commande", () => {
  it("donne un lien à copier et une clé de suivi, puis la position partagée", async () => {
    const { prisma, state } = formDb();
    const app = appFor(prisma);
    const created = await request(app).post("/api/location-requests").send({ senderName: "Koffi Mensah", recipientName: "Ama Kossi" }).expect(201);
    expect(created.body.url).toMatch(/^\/position\/[A-Za-z0-9_-]{22}$/);
    expect(created.body.text).toContain("Bonjour Ama, Koffi vous envoie un colis");
    expect(created.body.whatsappUrl).toBeUndefined();
    const key = created.body.pollKey;
    const token = created.body.url.split("/").pop();
    expect(key).not.toBe(token);

    // Le lien du destinataire ne permet pas de lire la réponse.
    await request(app).get(`/api/location-requests/${token}`).expect(404);
    expect((await request(app).get(`/api/location-requests/${key}`).expect(200)).body).toMatchObject({ status: "PENDING" });
    expect((await request(app).get(`/api/position/${token}`).expect(200)).body.senderFirstName).toBe("Koffi");

    await request(app).post(`/api/position/${token}`).send({ latitude: 6.1475, longitude: 1.2125, accuracy: 8, consent: true }).expect(200);
    expect(state.requests[0]).toMatchObject({ status: "SHARED", latitude: 6.1475, longitude: 1.2125 });
    expect((await request(app).get(`/api/location-requests/${key}`).expect(200)).body).toMatchObject({ status: "SHARED", latitude: 6.1475, longitude: 1.2125, accuracy: 8 });
  });

  it("met la position reçue sur la commande et fixe le prix à la distance", async () => {
    const { prisma, state } = formDb();
    const app = appFor(prisma);
    const { body } = await request(app).post("/api/location-requests").send({ senderName: "Koffi" }).expect(201);
    await request(app).post(`/api/position/${body.url.split("/").pop()}`).send({ latitude: 6.1475, longitude: 1.2125, consent: true }).expect(200);
    const res = await request(app)
      .post("/api/parcels")
      .send({ ...parcel, pickupLatitude: 6.1319, pickupLongitude: 1.2386, locationRequestKey: body.pollKey })
      .expect(201);
    expect(res.body).toMatchObject({ total: 1500, awaitingPosition: false, priceToConfirm: false, locationLink: null });
    expect(state.orders[0]).toMatchObject({ zoneId: "z-adidogome", latitude: 6.1475, longitude: 1.2125, locationSource: "RECIPIENT", distanceKm: 3.4, deliveryFee: 1000 });
    expect(state.requests[0]).toMatchObject({ orderId: "o1", status: "SHARED" });
  });

  it("sans réponse, la commande attend la position avec le même lien", async () => {
    const { prisma, state } = formDb();
    const app = appFor(prisma);
    const { body } = await request(app).post("/api/location-requests").send({ senderName: "Koffi" }).expect(201);
    const res = await request(app).post("/api/parcels").send({ ...parcel, pickupAddress: "Bè Kpota, maison bleue", locationRequestKey: body.pollKey }).expect(201);
    expect(res.body).toMatchObject({ awaitingPosition: true, locationLink: null });
    expect(state.orders[0]).toMatchObject({ latitude: null, address: ADDRESS_FROM_RECIPIENT, zoneId: "parcels" });
    expect(state.requests[0]).toMatchObject({ orderId: "o1", status: "PENDING" });
  });
});

describe("adresse ou position", () => {
  it("accepte l'une ou l'autre, au retrait comme à la livraison", async () => {
    const { prisma, state } = formDb();
    const app = appFor(prisma);
    const none = await request(app).post("/api/parcels").send({ ...parcel, address: "Adidogomé" }).expect(400);
    expect(none.body.error).toBe("Indiquez l'adresse ou la position du retrait");
    const noDrop = await request(app).post("/api/parcels").send({ ...parcel, pickupLatitude: 6.13, pickupLongitude: 1.23 }).expect(400);
    expect(noDrop.body.error).toBe("Indiquez l'adresse ou la position du destinataire");

    // Position du retrait seule (pas d'adresse écrite) et point de livraison : prix à la distance.
    const a = await request(app).post("/api/parcels").send({ ...parcel, pickupLatitude: 6.1319, pickupLongitude: 1.2386, latitude: 6.1475, longitude: 1.2125 }).expect(201);
    expect(a.body).toMatchObject({ total: 1500, priceToConfirm: false });
    expect(state.orders[0].zoneId).toBe("z-adidogome");
    // Point près de Bè : zone de Bè, sans que le client la choisisse.
    await request(app).post("/api/parcels").send({ ...parcel, pickupLatitude: 6.1475, pickupLongitude: 1.2125, latitude: 6.131, longitude: 1.238 }).expect(201);
    expect(state.orders[1].zoneId).toBe("z-be");
    // Adresses écrites seules : tarif minimum, à confirmer par Zedeka.
    const b = await request(app).post("/api/parcels").send({ ...parcel, pickupAddress: "Bè Kpota", address: "Adidogomé, rond-point" }).expect(201);
    expect(b.body).toMatchObject({ total: 1500, priceToConfirm: true, awaitingPosition: false });
    // Sans position : zone à déterminer, attribuée par la répartition.
    expect(state.orders[2]).toMatchObject({ zoneId: "parcels", distanceKm: null, locationSource: null });
  });

  it("refuse une clé de demande inconnue ou expirée", async () => {
    const { prisma } = formDb();
    await request(appFor(prisma)).post("/api/parcels").send({ ...parcel, pickupAddress: "Bè Kpota", locationRequestKey: newLocationToken() }).expect(400);
  });
});

describe("paiement d'un colis", () => {
  it("refuse le mobile money tant que l'admin ne l'a pas activé", async () => {
    const { prisma, state } = formDb();
    const res = await request(appFor(prisma)).post("/api/parcels").send({ ...parcel, pickupAddress: "Bè Kpota", address: "Adidogomé", paymentMethod: "MOBILE_MONEY" }).expect(400);
    expect(res.body.error).toContain("mobile money");
    expect(state.orders).toHaveLength(0);
  });

  it("laisse le destinataire payer, en espèces à la livraison", async () => {
    const { prisma, state } = formDb();
    await request(appFor(prisma)).post("/api/parcels").send({ ...parcel, pickupAddress: "Bè Kpota", address: "Adidogomé", payer: "RECIPIENT", paymentMethod: "MOBILE_MONEY" }).expect(201);
    expect(state.orders[0]).toMatchObject({ payer: "RECIPIENT", paymentMethod: "CASH" });
  });
});

describe("lien Google Maps collé", () => {
  it("lit les formes courantes", () => {
    expect(parseMapsLink("https://www.google.com/maps/place/Lom%C3%A9/@6.1319,1.2228,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d6.1375!4d1.2123")).toEqual({ latitude: 6.1375, longitude: 1.2123 });
    expect(parseMapsLink("https://maps.google.com/?q=6.1475,1.2125")).toEqual({ latitude: 6.1475, longitude: 1.2125 });
    expect(parseMapsLink("https://www.google.com/maps/search/6.1475,+1.2125?entry=tts")).toEqual({ latitude: 6.1475, longitude: 1.2125 });
    expect(parseMapsLink("6.1475, 1.2125")).toEqual({ latitude: 6.1475, longitude: 1.2125 });
    expect(parseMapsLink("Adidogomé, rond-point")).toBeNull();
  });

  it("suit un lien court partagé depuis le téléphone, sans appeler d'autre site", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location: "https://www.google.com/maps/place/@6.1475,1.2125,17z" } });
    };
    expect(await resolveMapsLink("https://maps.app.goo.gl/AbCdEf123", fetcher)).toEqual({ latitude: 6.1475, longitude: 1.2125 });
    expect(calls).toEqual(["https://maps.app.goo.gl/AbCdEf123"]);
    expect(await resolveMapsLink("https://exemple.tg/maps", fetcher)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
