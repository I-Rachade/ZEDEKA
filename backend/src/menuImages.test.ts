import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { memoryStore } from "./storage.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);

describe("photos des plats envoyées depuis l'appareil", () => {
  const restaurant = { id: "r1", name: "Chez Ama", phone: "+228 90 00 00 00", address: "Bè", ownerEmail: "gerant@ama.tg", ownerPasswordHash: bcrypt.hashSync("gerant-2026", 4), sessionsValidFrom: null, commissionRate: 10, subscriptionFee: null, openingHours: "[]", active: true, temporarilyClosed: false, closedUntil: null };
  const cashier = { id: "s1", restaurantId: "r1", name: "Afi", email: "afi@ama.tg", passwordHash: bcrypt.hashSync("caisse-2026", 4), role: "CASHIER", active: true, sessionsValidFrom: null, restaurant: { name: "Chez Ama" } };
  const prisma = {
    restaurant: {
      findUnique: async ({ where }: { where: { id?: string; ownerEmail?: string } }) => (where.id === "r1" || where.ownerEmail === restaurant.ownerEmail ? { ...restaurant, zone: null } : null),
      update: async () => restaurant,
    },
    restaurantStaff: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => (where.id === "s1" || where.email === cashier.email ? cashier : null),
      update: async () => cashier,
    },
  } as unknown as PrismaClient;
  const files = memoryStore();
  const app = createApp(prisma, { frontendOrigin: "https://zedeka.example", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64), files });
  const token = async (email: string, password: string) => (await request(app).post("/api/restaurant/login").send({ email, password }).expect(200)).body.token as string;

  it("le restaurant envoie une photo, reçoit un lien complet, et le client la voit", async () => {
    const auth = `Bearer ${await token("gerant@ama.tg", "gerant-2026")}`;
    const res = await request(app).post("/api/restaurant/images").set("authorization", auth).set("content-type", "image/jpeg").send(JPEG).expect(201);
    expect(res.body.url).toMatch(/^https:\/\/zedeka\.example\/api\/media\/menu-images\/r1\/[0-9a-f-]{36}\.jpg$/);
    expect(files.files.size).toBe(1);

    const path = new URL(res.body.url).pathname;
    const photo = await request(app).get(path).expect(200);
    expect(photo.headers["content-type"]).toBe("image/jpeg");
    expect(photo.headers["cache-control"]).toContain("immutable");
    expect(Buffer.from(photo.body)).toEqual(JPEG);
  });

  it("range la vignette à côté de la photo ; sans vignette, la photo entière est servie", async () => {
    const auth = `Bearer ${await token("gerant@ama.tg", "gerant-2026")}`;
    const full = await request(app).post("/api/restaurant/images").set("authorization", auth).set("content-type", "image/jpeg").send(JPEG).expect(201);
    const path = new URL(full.body.url).pathname;
    const name = path.slice(path.lastIndexOf("/") + 1);
    // Photo envoyée avant les vignettes : ?size=thumb renvoie la photo entière.
    const fallback = await request(app).get(`${path}?size=thumb`).expect(200);
    expect(Buffer.from(fallback.body)).toEqual(JPEG);
    expect(fallback.headers["x-thumb"]).toBe("missing");
    expect(fallback.headers["cache-control"]).not.toContain("immutable");

    const THUMB = Buffer.from([...JPEG, 9, 9]);
    const thumb = await request(app).post(`/api/restaurant/images?thumbOf=${name}`).set("authorization", auth).set("content-type", "image/jpeg").send(THUMB).expect(201);
    expect(thumb.body.url).toBe(`${full.body.url}?size=thumb`);
    const served = await request(app).get(`${path}?size=thumb`).expect(200);
    expect(served.headers["cache-control"]).toContain("immutable");
    expect(served.headers["x-thumb"]).toBeUndefined();
    expect(Buffer.from(served.body)).toEqual(THUMB);
    // La photo entière ne change pas.
    expect(Buffer.from((await request(app).get(path).expect(200)).body)).toEqual(JPEG);
    // Nom de vignette invalide refusé.
    await request(app).post("/api/restaurant/images?thumbOf=../x.jpg").set("authorization", auth).set("content-type", "image/jpeg").send(THUMB).expect(400);
  });

  it("photo et vignette en WebP", async () => {
    const auth = `Bearer ${await token("gerant@ama.tg", "gerant-2026")}`;
    const WEBP = Buffer.from([...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBPVP8 "), 1, 2, 3]);
    const full = await request(app).post("/api/restaurant/images").set("authorization", auth).set("content-type", "image/webp").send(WEBP).expect(201);
    expect(full.body.url).toMatch(/\.webp$/);
    const path = new URL(full.body.url).pathname;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const THUMB = Buffer.from([...WEBP, 9]);
    await request(app).post(`/api/restaurant/images?thumbOf=${name}`).set("authorization", auth).set("content-type", "image/webp").send(THUMB).expect(201);
    const served = await request(app).get(`${path}?size=thumb`).expect(200);
    expect(served.headers["content-type"]).toBe("image/webp");
    expect(Buffer.from(served.body)).toEqual(THUMB);
  });

  it("refuse ce qui n'est pas une image, et les envois sans connexion ou par la caissière", async () => {
    const auth = `Bearer ${await token("gerant@ama.tg", "gerant-2026")}`;
    await request(app).post("/api/restaurant/images").set("authorization", auth).set("content-type", "image/jpeg").send(Buffer.from("<svg>pas une photo</svg>")).expect(400);
    await request(app).post("/api/restaurant/images").set("authorization", auth).set("content-type", "image/svg+xml").send(Buffer.from("<svg></svg>")).expect(400);
    await request(app).post("/api/restaurant/images").set("content-type", "image/jpeg").send(JPEG).expect(401);
    const cashierAuth = `Bearer ${await token("afi@ama.tg", "caisse-2026")}`;
    await request(app).post("/api/restaurant/images").set("authorization", cashierAuth).set("content-type", "image/jpeg").send(JPEG).expect(403);
  });

  it("ne sert que des photos de plats, pas les autres fichiers", async () => {
    await files.put("vendor-applications/x/doc.pdf", new Uint8Array([1]), "application/pdf");
    await request(app).get("/api/media/vendor-applications/x/doc.pdf").expect(404);
    await request(app).get("/api/media/menu-images/r1/..%2F..%2Fvendor-applications.jpg").expect(404);
  });
});
