import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { driverPhotoUrl, missingDocuments, readDriverPhotoToken } from "./driverDocuments.js";
import { assignMotorbike, needsMotorbike, releaseAtEndOfShift, releaseMotorbike } from "./fleet.js";

type Bike = { id: string; plate: string; active: boolean; driverId: string | null; assignedAt: Date | null };
type Shift = { id: string; motorbikeId: string; driverId: string; startedAt: Date; endedAt: Date | null; assignedBy: string | null };
type Driver = { id: string; employment: string; deletedAt: Date | null; plate: string | null };

// Base en mémoire : motos, prises de moto, livreurs et courses en cours.
function setup() {
  const bikes: Bike[] = [
    { id: "m1", plate: "TG-1111-A", active: true, driverId: null, assignedAt: null },
    { id: "m2", plate: "TG-2222-B", active: true, driverId: null, assignedAt: null },
    { id: "m3", plate: "TG-3333-C", active: false, driverId: null, assignedAt: null },
  ];
  const shifts: Shift[] = [];
  const drivers: Driver[] = [
    { id: "kofi", employment: "STAFF", deletedAt: null, plate: null },
    { id: "ama", employment: "STAFF", deletedAt: null, plate: null },
    { id: "yao", employment: "FREELANCE", deletedAt: null, plate: "TG-9999-Z" },
  ];
  const openOrders: Record<string, number> = {};
  const fits = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => row[k] === v);
  const prisma = {
    motorbike: {
      count: async ({ where }: { where: Partial<Bike> }) => bikes.filter((b) => fits(b, where)).length,
      findUnique: async ({ where }: { where: { id?: string; driverId?: string } }) => bikes.find((b) => (where.id ? b.id === where.id : b.driverId === where.driverId)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Bike> }) => Object.assign(bikes.find((b) => b.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Partial<Bike>; data: Partial<Bike> }) => {
        const rows = bikes.filter((b) => fits(b, where));
        rows.forEach((b) => Object.assign(b, data));
        return { count: rows.length };
      },
    },
    motorbikeShift: {
      create: async ({ data }: { data: Omit<Shift, "id" | "endedAt"> }) => {
        const row = { id: `s${shifts.length + 1}`, endedAt: null, ...data };
        shifts.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Partial<Shift>; data: Partial<Shift> }) => {
        const rows = shifts.filter((s) => fits(s, where));
        rows.forEach((s) => Object.assign(s, data));
        return { count: rows.length };
      },
    },
    driver: {
      findUnique: async ({ where }: { where: { id: string } }) => drivers.find((d) => d.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Driver> }) => Object.assign(drivers.find((d) => d.id === where.id)!, data),
    },
    order: { count: async ({ where }: { where: { driverId: string } }) => openOrders[where.driverId] ?? 0 },
  } as unknown as PrismaClient;
  return { prisma, bikes, shifts, drivers, openOrders };
}

describe("parc de motos", () => {
  it("le salarié prend une moto libre : sa plaque devient celle de la moto, la prise est notée", async () => {
    const { prisma, bikes, shifts, drivers } = setup();
    await assignMotorbike(prisma, "m1", "kofi", null);
    expect(bikes[0].driverId).toBe("kofi");
    expect(drivers[0].plate).toBe("TG-1111-A");
    expect(shifts).toMatchObject([{ motorbikeId: "m1", driverId: "kofi", endedAt: null, assignedBy: null }]);
  });

  it("une moto prise, retirée du service, ou un livreur indépendant : refusé", async () => {
    const { prisma } = setup();
    await assignMotorbike(prisma, "m1", "kofi", null);
    await expect(assignMotorbike(prisma, "m1", "ama", null)).rejects.toThrow(/prise par un autre livreur/);
    await expect(assignMotorbike(prisma, "m3", "ama", null)).rejects.toThrow(/retirée du service/);
    await expect(assignMotorbike(prisma, "m2", "yao", null)).rejects.toThrow(/salariés/);
  });

  it("une seule moto à la fois : en changer rend la précédente", async () => {
    const { prisma, bikes, shifts, drivers } = setup();
    await assignMotorbike(prisma, "m1", "kofi", null);
    await assignMotorbike(prisma, "m2", "kofi", "Directeur");
    expect(bikes.map((b) => b.driverId)).toEqual([null, "kofi", null]);
    expect(drivers[0].plate).toBe("TG-2222-B");
    expect(shifts[0].endedAt).toBeInstanceOf(Date);
    expect(shifts[1]).toMatchObject({ motorbikeId: "m2", endedAt: null, assignedBy: "Directeur" });
  });

  it("fin de service : la moto est rendue, sauf pendant une course", async () => {
    const { prisma, bikes, drivers, openOrders } = setup();
    await assignMotorbike(prisma, "m1", "kofi", null);
    openOrders.kofi = 1;
    expect(await releaseAtEndOfShift(prisma, "kofi")).toBe(false);
    expect(bikes[0].driverId).toBe("kofi");
    openOrders.kofi = 0;
    expect(await releaseAtEndOfShift(prisma, "kofi")).toBe(true);
    expect(bikes[0].driverId).toBeNull();
    expect(drivers[0].plate).toBeNull();
    expect(await releaseMotorbike(prisma, "kofi")).toBe(false);
  });

  it("la moto n'est demandée qu'aux salariés à moto, et seulement si le parc en a une", async () => {
    const { prisma, bikes } = setup();
    expect(await needsMotorbike(prisma, { employment: "STAFF", vehicle: "MOTO" })).toBe(true);
    expect(await needsMotorbike(prisma, { employment: "STAFF", vehicle: "VELO" })).toBe(false);
    expect(await needsMotorbike(prisma, { employment: "FREELANCE", vehicle: "MOTO" })).toBe(false);
    bikes.forEach((b) => (b.active = false));
    expect(await needsMotorbike(prisma, { employment: "STAFF", vehicle: "MOTO" })).toBe(false);
  });
});

describe("pièces du livreur", () => {
  it("photo de profil et pièce d'identité attendues", () => {
    expect(missingDocuments([])).toEqual(["SELFIE", "ID_CARD"]);
    expect(missingDocuments(["SELFIE", "MOTO"])).toEqual(["ID_CARD"]);
    expect(missingDocuments(["SELFIE", "ID_CARD"])).toEqual([]);
  });

  it("le lien de la photo de profil est signé et expire", () => {
    const now = Date.UTC(2026, 10, 12, 13, 20);
    const url = driverPhotoUrl("secret", "kofi", now);
    const token = url.split("/").pop()!;
    expect(readDriverPhotoToken("secret", token, now)).toBe("kofi");
    // Même lien pendant l'heure (cache du navigateur).
    expect(driverPhotoUrl("secret", "kofi", now + 10 * 60_000)).toBe(url);
    expect(readDriverPhotoToken("autre", token, now)).toBeNull();
    expect(readDriverPhotoToken("secret", token.replace("kofi", "ama"), now)).toBeNull();
    expect(readDriverPhotoToken("secret", token, now + 8 * 3_600_000)).toBeNull();
  });
});
