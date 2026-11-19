import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { newReceiptKey, RECEIPT_KEY_HEADER } from "./receipt.js";

// Annulation par le client depuis son suivi : gratuite, seulement pendant le délai et avant la préparation.
describe("annulation par le client", () => {
  const { key, hash } = newReceiptKey();
  const base = {
    id: "o1",
    code: "ZD-ZVKE-7CDX",
    type: "FOOD",
    status: "PENDING",
    customerId: null,
    receiptKeyHash: hash,
    storeSale: false,
    restaurantId: "r1",
    restaurant: { name: "Chez Tante Ama" },
    driver: null,
    deliveryFee: 1000,
    extraFee: 0,
    paymentMethod: "CASH",
    confirmedAt: null,
    createdAt: new Date(),
  };
  const appWith = (order: unknown) => {
    const writes: unknown[] = [];
    const prisma = {
      order: {
        findUnique: async () => order,
        updateMany: async (args: unknown) => (writes.push(args), { count: 1 }),
      },
      driverAssignment: { updateMany: async () => ({ count: 0 }) },
      settings: { findFirst: async () => ({ id: 1, freeCancellationMinutes: 5, cancellationFeePercent: 50 }), upsert: async () => ({ id: 1, freeCancellationMinutes: 5, cancellationFeePercent: 50 }) },
    } as unknown as PrismaClient;
    return { app: createApp(prisma, { frontendOrigin: "http://localhost", zedekaWhatsapp: "" }), writes };
  };

  it("annule sans frais pendant le délai, depuis le téléphone qui a commandé", async () => {
    const { app, writes } = appWith(base);
    await request(app).post("/api/orders/ZD-ZVKE-7CDX/cancel").set(RECEIPT_KEY_HEADER, key).expect(200);
    expect(writes[0]).toMatchObject({ where: { id: "o1", status: "PENDING" }, data: { status: "CANCELLED", cancellationFee: 0, cancellationReason: "Annulée par le client" } });
  });

  it("refuse un autre appareil", async () => {
    await request(appWith(base).app).post("/api/orders/ZD-ZVKE-7CDX/cancel").expect(403);
  });

  it("refuse une fois le repas en préparation ou le délai passé", async () => {
    await request(appWith({ ...base, status: "PREPARING" }).app).post("/api/orders/ZD-ZVKE-7CDX/cancel").set(RECEIPT_KEY_HEADER, key).expect(409);
    await request(appWith({ ...base, createdAt: new Date(Date.now() - 10 * 60_000) }).app).post("/api/orders/ZD-ZVKE-7CDX/cancel").set(RECEIPT_KEY_HEADER, key).expect(409);
  });
});
