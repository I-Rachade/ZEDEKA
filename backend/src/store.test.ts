import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { byteRange } from "./routes/menuImages.js";
import { invalidateServices, listModules } from "./services.js";

describe("vidéos publicitaires : lecture par morceaux", () => {
  it("comprend l'en-tête Range", () => {
    expect(byteRange(undefined, 100)).toBeNull();
    expect(byteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(byteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=100-", 100)).toBe("invalid");
    expect(byteRange("lignes=1-2", 100)).toBe("invalid");
  });
});

describe("module « Boutiques »", () => {
  beforeEach(() => invalidateServices());
  const prisma = (rows: { code: string; state: string; sortOrder: number }[] = []) =>
    ({
      serviceModule: { findMany: async () => rows },
      settings: { findFirst: async () => ({ id: 1, zedEnabled: false, zedButtonColor: "SUN" }) },
    }) as unknown as PrismaClient;

  it("est coupé par défaut et ne s'affiche pas aux clients", async () => {
    const shop = (await listModules(prisma())).find((m) => m.code === "SHOP");
    expect(shop?.state).toBe("OFF");
    const res = await request(createApp(prisma(), { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) })).get("/api/services").expect(200);
    expect(res.body.modules.map((m: { code: string }) => m.code)).not.toContain("SHOP");
  });

  it("annoncé « Bientôt » après activation dans l'admin, sans lien tant que la vente n'est pas ouverte", async () => {
    const res = await request(createApp(prisma([{ code: "SHOP", state: "SOON", sortOrder: 70 }]), { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) }))
      .get("/api/services")
      .expect(200);
    const shop = res.body.modules.find((m: { code: string }) => m.code === "SHOP");
    expect(shop).toMatchObject({ state: "SOON", href: null });
  });

});
