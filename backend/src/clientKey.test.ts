import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// Envoi différé (hors ligne) : la même clé ne crée pas une seconde commande.
const parcel = {
  acceptTerms: true,
  customerName: "Ama Koffi",
  customerPhone: "90 11 22 33",
  paymentMethod: "CASH",
  pickupAddress: "Bè Kpota, près du marché",
  address: "Agoè Assiyéyé, maison jaune",
  recipientName: "Koffi Mensah",
  recipientPhone: "91 00 00 00",
  parcelCategoryId: "cat",
  weightKg: 3,
  clientKey: "k_0123456789abcdef",
};

function fakeDb(existing: { customerId: string | null } | null) {
  const updates: unknown[] = [];
  const prisma = {
    order: {
      findUnique: async ({ where }: { where: { clientKey?: string } }) =>
        existing && where.clientKey === parcel.clientKey ? { id: "o1", code: "ZD-AAAA-BBBB", total: 1900, tableNumber: null, customerId: existing.customerId } : null,
      update: async (args: unknown) => (updates.push(args), {}),
    },
    parcelCategory: { findFirst: async () => null },
    settings: { findUnique: async () => null, findFirst: async () => null, upsert: async () => ({}), create: async () => ({ id: 1 }) },
  } as unknown as PrismaClient;
  return { prisma, updates };
}

describe("clé anti-doublon", () => {
  it("renvoie le colis déjà créé, avec une nouvelle clé de reçu sans compte", async () => {
    const { prisma, updates } = fakeDb({ customerId: null });
    const res = await request(createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" })).post("/api/parcels").send(parcel).expect(200);
    expect(res.body).toMatchObject({ code: "ZD-AAAA-BBBB", total: 1900, duplicate: true });
    expect(res.body.receiptKey).toEqual(expect.any(String));
    expect(updates).toHaveLength(1);
  });
  it("refuse une clé mal formée", async () => {
    const { prisma } = fakeDb(null);
    await request(createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" })).post("/api/parcels").send({ ...parcel, clientKey: "court" }).expect(400);
  });
  it("sans commande existante, continue la création normale", async () => {
    const { prisma } = fakeDb(null);
    // Catégorie inconnue dans ce faux : la création s'arrête là, preuve qu'on est passé après la clé.
    const res = await request(createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "" })).post("/api/parcels").send(parcel);
    expect(res.body.error).toBe("Catégorie de colis inconnue");
  });
});

describe("deux envois identiques en même temps", () => {
  const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  it("signale la commande déjà créée au lieu de réessayer avec un autre code", async () => {
    const { createOrderWithCode, DuplicateOrderError } = await import("./util.js");
    let creates = 0;
    const prisma = {
      order: {
        create: async () => {
          creates++;
          throw conflict;
        },
        findFirst: async () => ({ id: "o1" }),
      },
    } as unknown as PrismaClient;
    await expect(createOrderWithCode(prisma, { clientKey: parcel.clientKey } as never)).rejects.toBeInstanceOf(DuplicateOrderError);
    expect(creates).toBe(1);
  });
  it("réessaie quand c'est le code de suivi qui collisionne", async () => {
    const { createOrderWithCode } = await import("./util.js");
    let creates = 0;
    const prisma = {
      order: {
        create: async () => {
          if (++creates === 1) throw conflict;
          return { id: "o2" };
        },
        findFirst: async () => null,
      },
    } as unknown as PrismaClient;
    await expect(createOrderWithCode(prisma, { clientKey: parcel.clientKey } as never)).resolves.toEqual({ id: "o2" });
    expect(creates).toBe(2);
  });
});
