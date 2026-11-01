import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { purgeExpiredData } from "./retention.js";
import { memoryStore } from "./storage.js";

// Durées de conservation de la politique de confidentialité : ce qui est trop vieux part, le reste demeure.

const DAY = 24 * 60 * 60 * 1000;

describe("conservation des données", () => {
  it("efface codes, positions et candidatures refusées échus, avec leurs fichiers", async () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const calls: Record<string, unknown[]> = {};
    const log = (name: string) => async (q: unknown) => {
      (calls[name] ??= []).push(q);
      return { count: 2 };
    };
    const deleted: string[] = [];
    const prisma = {
      otpCode: { deleteMany: log("otp") },
      passwordReset: { deleteMany: log("resets") },
      driverLocation: { deleteMany: log("locations") },
      staffNotification: { deleteMany: log("notifications") },
      driver: { deleteMany: log("drivers") },
      vendorApplication: {
        findMany: async (q: unknown) => {
          (calls.applications ??= []).push(q);
          return [{ id: "a1", logoPath: "v/a1/logo.png", coverPath: "v/a1/cover.png", legalDocPath: null }];
        },
        delete: async ({ where }: { where: { id: string } }) => deleted.push(where.id),
      },
    } as unknown as PrismaClient;
    const files = memoryStore();
    await files.put("v/a1/logo.png", new Uint8Array([1]), "image/png");
    await files.put("v/a1/cover.png", new Uint8Array([1]), "image/png");
    await files.put("autre.png", new Uint8Array([1]), "image/png");

    const result = await purgeExpiredData(prisma, files, now);

    const cutoff = (name: string) => (calls[name][0] as { where: { createdAt: { lt: Date } } }).where.createdAt.lt.getTime();
    expect(now.getTime() - cutoff("otp")).toBe(DAY);
    expect(now.getTime() - cutoff("resets")).toBe(DAY);
    expect(now.getTime() - cutoff("locations")).toBe(90 * DAY);
    expect(now.getTime() - cutoff("notifications")).toBe(30 * DAY);
    expect(now.getTime() - cutoff("drivers")).toBe(365 * DAY);
    expect((calls.drivers[0] as { where: { status: string } }).where.status).toBe("REJECTED");
    expect((calls.applications[0] as { where: { status: string; restaurantId: null } }).where).toMatchObject({ status: "REJECTED", restaurantId: null });
    expect(deleted).toEqual(["a1"]);
    expect([...files.files.keys()]).toEqual(["autre.png"]);
    expect(result).toEqual({ otp: 2, resets: 2, locations: 2, notifications: 2, vendorApplications: 1, drivers: 2 });
  });
});
