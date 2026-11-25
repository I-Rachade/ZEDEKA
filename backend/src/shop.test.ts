import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { invalidateServices } from "./services.js";

describe("rubrique « Boutiques » côté client", () => {
  beforeEach(() => invalidateServices());
  const config = { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const prisma = (state: string, commerces: unknown[] = []) =>
    ({
      serviceModule: { findMany: async () => [{ code: "SHOP", state, sortOrder: 70 }] },
      settings: { findFirst: async () => ({ id: 1, zedEnabled: false, zedButtonColor: "SUN" }) },
      restaurant: { findMany: async () => commerces },
    }) as unknown as PrismaClient;

  it("fermée tant que le module n'est pas ouvert", async () => {
    const app = createApp(prisma("SOON"), config);
    await request(app).get("/api/shops").expect(404);
  });

  it("ouverte : liste vide et catégories", async () => {
    const app = createApp(prisma("ON"), config);
    const res = await request(app).get("/api/shops").expect(200);
    expect(res.body.shops).toEqual([]);
    expect(res.body.categories.length).toBeGreaterThan(0);
  });

  it("liste aussi les commerces de type Boutique, qui mènent à leur page /r/…", async () => {
    const app = createApp(
      prisma("ON", [
        {
          slug: "ama-mode",
          name: "Ama Mode",
          address: "Bè, Lomé",
          shopCategory: "mode",
          logoUrl: null,
          banners: [{ url: "https://zedeka.tg/b.webp" }],
          menuItems: [{ imageUrl: "https://zedeka.tg/p.webp" }],
          _count: { menuItems: 12 },
        },
      ]),
      config,
    );
    const res = await request(app).get("/api/shops").expect(200);
    expect(res.body.shops[0]).toMatchObject({ slug: "ama-mode", href: "/r/ama-mode", category: { key: "mode" }, coverUrl: "https://zedeka.tg/b.webp", productCount: 12 });
  });
});
