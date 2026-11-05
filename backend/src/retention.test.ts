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
      driver: {
        findMany: async (q: { where: Record<string, unknown> }) => {
          const name = "zedStatus" in q.where ? "zedRejected" : "drivers";
          (calls[name] ??= []).push(q);
          return name === "drivers" ? [{ id: "d1" }, { id: "d2" }] : [{ id: "d3" }];
        },
        delete: async ({ where }: { where: { id: string } }) => deleted.push(where.id),
        update: async ({ where, data }: { where: { id: string }; data: unknown }) => (calls.driverUpdates ??= []).push({ id: where.id, data }),
      },
      zedDocument: {
        findMany: async ({ where }: { where: { driverId: string } }) => (where.driverId === "d3" ? [{ fileKey: "zed/d3/selfie-1" }] : []),
        deleteMany: log("zedDocuments"),
      },
      supportRequest: { updateMany: log("support") },
      supportRequestNote: { deleteMany: log("supportNotes") },
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
    await files.put("zed/d3/selfie-1", new Uint8Array([1]), "image/jpeg");
    await files.put("autre.png", new Uint8Array([1]), "image/png");

    const result = await purgeExpiredData(prisma, files, now);

    const cutoff = (name: string) => (calls[name][0] as { where: { createdAt: { lt: Date } } }).where.createdAt.lt.getTime();
    expect(now.getTime() - cutoff("otp")).toBe(DAY);
    expect(now.getTime() - cutoff("resets")).toBe(DAY);
    expect(now.getTime() - cutoff("locations")).toBe(90 * DAY);
    expect(now.getTime() - cutoff("notifications")).toBe(30 * DAY);
    const driversWhere = (calls.drivers[0] as { where: { status: string; createdAt: { lt: Date } } }).where;
    expect(now.getTime() - driversWhere.createdAt.lt.getTime()).toBe(365 * DAY);
    expect(driversWhere.status).toBe("REJECTED");
    expect((calls.applications[0] as { where: { status: string; restaurantId: null } }).where).toMatchObject({ status: "REJECTED", restaurantId: null });
    // Candidature de commerce, deux livreurs refusés ; le livreur au dossier Zed refusé garde son compte.
    expect(deleted).toEqual(["a1", "d1", "d2"]);
    expect(calls.driverUpdates).toEqual([{ id: "d3", data: { plate: null } }]);
    expect([...files.files.keys()]).toEqual(["autre.png"]);
    // Demandes au support : 2 ans après la clôture.
    const support = (calls.support[0] as { where: { status: string; closedAt: { lt: Date } }; data: unknown });
    expect(support.where.status).toBe("DONE");
    expect(now.getTime() - support.where.closedAt.lt.getTime()).toBe(730 * DAY);
    expect(support.data).toEqual({ contactName: null, contactPhone: null, details: null });
    expect(result).toEqual({ otp: 2, resets: 2, locations: 2, notifications: 2, vendorApplications: 1, drivers: 2, zedApplications: 1, supportRequests: 2 });
  });
});
