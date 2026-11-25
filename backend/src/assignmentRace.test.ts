import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { answerAssignment } from "./routes/driverApp.js";

// D1 n'a pas de transactions : la réponse du livreur ne doit s'écrire que sur une proposition encore en attente.
function fakePrisma(status: string) {
  const row = { id: "a1", status };
  const prisma = {
    driverAssignment: {
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (row.id !== where.id || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, row };
}

describe("réponse du livreur à une proposition", () => {
  it("accepte une proposition encore envoyée", async () => {
    const { prisma, row } = fakePrisma("SENT");
    expect(await answerAssignment(prisma, "a1", { status: "ACCEPTED", respondedAt: new Date() })).toBe(true);
    expect(row.status).toBe("ACCEPTED");
  });

  it("ne relance pas une proposition retirée par la répartition ou expirée entre la lecture et l'écriture", async () => {
    for (const status of ["WITHDRAWN", "EXPIRED", "REJECTED"]) {
      const { prisma, row } = fakePrisma(status);
      expect(await answerAssignment(prisma, "a1", { status: "ACCEPTED", respondedAt: new Date() })).toBe(false);
      expect(row.status).toBe(status);
    }
  });
});
