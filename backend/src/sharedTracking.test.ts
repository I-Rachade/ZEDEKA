import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// Lien de suivi envoyé à quelqu'un sans l'appli : la carte et le livreur, jamais un numéro de téléphone.
describe("suivi partagé par lien", () => {
  const base = {
    type: "PARCEL",
    status: "PICKED_UP",
    fulfillment: "DELIVERY",
    tableNumber: null,
    latitude: 6.13456,
    longitude: 1.23321,
    pickupLatitude: 6.15,
    pickupLongitude: 1.21,
    restaurant: null,
    driver: { id: "d1", name: "Kossi Mensah", plate: "TG-1234", vehicle: "MOTO", phone: "+22890000000", lastLatitude: 6.14, lastLongitude: 1.22, lastLocationAt: new Date() },
  };
  const appWith = (order: unknown) => {
    const prisma = {
      order: {
        findUnique: async () => order,
        aggregate: async () => ({ _avg: { driverRating: 4.5 }, _count: { driverRating: 2 } }),
        count: async () => 12,
      },
    } as unknown as PrismaClient;
    return createApp(prisma, { frontendOrigin: "http://localhost", zedekaWhatsapp: "" });
  };

  it("montre le trajet (point de livraison arrondi) et la position du livreur, sans téléphone", async () => {
    const res = await request(appWith(base)).get("/api/orders/zd-zvke-7cdx/live").expect(200);
    expect(res.body.map.from).toEqual({ latitude: 6.15, longitude: 1.21 });
    expect(res.body.map.to).toEqual({ latitude: 6.135, longitude: 1.233 });
    expect(res.body.map.driver.latitude).toBe(6.14);
    expect(res.body.driver).toMatchObject({ firstName: "Kossi", vehicle: "MOTO", plate: "TG-1234", photoUrl: null, deliveries: 12 });
    expect(JSON.stringify(res.body)).not.toMatch(/2289|phone|Mensah/i);
  });

  it("ne montre plus rien une fois livrée", async () => {
    const res = await request(appWith({ ...base, status: "DELIVERED" })).get("/api/orders/ZD-ZVKE-7CDX/live").expect(200);
    expect(res.body).toEqual({ map: null, driver: null });
  });

  it("refuse les anciens codes courts, faciles à deviner", async () => {
    await request(appWith(base)).get("/api/orders/ZD-B4Q4/live").expect(404);
  });

  it("répond 404 pour un code inconnu", async () => {
    await request(appWith(null)).get("/api/orders/ZD-AAAA-BBBB/live").expect(404);
  });
});
