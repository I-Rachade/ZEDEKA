import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { memoryStore } from "./storage.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);
const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };

type Ad = { id: string; title: string; imageUrl: string; linkUrl: string | null; position: number; active: boolean; startsAt: Date | null; endsAt: Date | null; createdAt: Date };

// Faux Prisma : juste ce que les routes des publicités utilisent, avec le filtre « affichée maintenant ».
function fakePrisma() {
  const ads: Ad[] = [];
  let n = 0;
  const live = (a: Ad, now: Date) => a.active && (!a.startsAt || a.startsAt <= now) && (!a.endsAt || a.endsAt > now);
  const prisma = {
    ad: {
      findMany: async ({ where, take }: { where?: { active?: boolean; AND?: { OR: { startsAt?: { lte: Date }; endsAt?: { gt: Date } }[] }[] }; take?: number } = {}) => {
        const now = (where?.AND?.[0].OR[1].startsAt?.lte as Date | undefined) ?? null;
        const list = ads.filter((a) => (now ? live(a, now) : true)).sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
        return list.slice(0, take ?? list.length);
      },
      findUnique: async ({ where }: { where: { id: string } }) => ads.find((a) => a.id === where.id) ?? null,
      create: async ({ data }: { data: Omit<Ad, "id" | "createdAt"> }) => {
        const ad = { ...data, id: `ad${++n}`, createdAt: new Date(Date.now() + n) };
        ads.push(ad);
        return ad;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Ad> }) => Object.assign(ads.find((a) => a.id === where.id)!, data),
      delete: async ({ where }: { where: { id: string } }) => ads.splice(ads.findIndex((a) => a.id === where.id), 1)[0],
    },
    teamMember: { findUnique: async () => ({ id: "m1", name: "Kodjo", role: "DISPATCHER", active: true }) },
  } as unknown as PrismaClient;
  return { prisma, ads };
}

describe("publicités de l'accueil", () => {
  const { prisma, ads } = fakePrisma();
  const files = memoryStore();
  const app = createApp(prisma, { frontendOrigin: "https://zedeka.example", zedekaWhatsapp: "", files, ...STRONG });
  const director = async () => `Bearer ${(await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200)).body.token}`;

  it("le directeur ajoute une publicité avec une image envoyée depuis l'appareil ; le client la voit", async () => {
    const auth = await director();
    const img = await request(app).post("/api/admin/ads/images").set("authorization", auth).set("content-type", "image/jpeg").send(JPEG).expect(201);
    expect(img.body.url).toMatch(/^https:\/\/zedeka\.example\/api\/media\/menu-images\/ads\/[0-9a-f-]{36}\.jpg$/);
    await request(app).get(new URL(img.body.url).pathname).expect(200);

    await request(app).post("/api/admin/ads").set("authorization", auth).send({ title: "Promo Chez Ama", imageUrl: img.body.url, linkUrl: "/app/recherche", position: 2 }).expect(201);
    await request(app).post("/api/admin/ads").set("authorization", auth).send({ title: "Colis -20 %", imageUrl: "https://cdn.example/colis.jpg", position: 1 }).expect(201);

    const res = await request(app).get("/api/ads").expect(200);
    expect(res.body.map((a: Ad) => a.title)).toEqual(["Colis -20 %", "Promo Chez Ama"]);
  });

  it("une publicité masquée ou hors de sa période n'est pas montrée au client", async () => {
    const auth = await director();
    await request(app).patch(`/api/admin/ads/${ads[0].id}`).set("authorization", auth).send({ active: false }).expect(200);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await request(app).post("/api/admin/ads").set("authorization", auth).send({ title: "Bientôt", imageUrl: "https://cdn.example/b.jpg", startsAt: future }).expect(201);
    const res = await request(app).get("/api/ads").expect(200);
    expect(res.body.map((a: Ad) => a.title)).toEqual(["Colis -20 %"]);
    // L'admin voit toutes les publicités.
    expect((await request(app).get("/api/admin/ads").set("authorization", auth).expect(200)).body).toHaveLength(3);
  });

  it("refuse les liens dangereux et les périodes à l'envers", async () => {
    const auth = await director();
    const base = { title: "Test", imageUrl: "https://cdn.example/t.jpg" };
    await request(app).post("/api/admin/ads").set("authorization", auth).send({ ...base, linkUrl: "javascript:alert(1)" }).expect(400);
    await request(app).post("/api/admin/ads").set("authorization", auth).send({ ...base, linkUrl: "//evil.example" }).expect(400);
    await request(app).post("/api/admin/ads").set("authorization", auth).send({ ...base, imageUrl: "http://cdn.example/t.jpg" }).expect(400);
    await request(app)
      .post("/api/admin/ads")
      .set("authorization", auth)
      .send({ ...base, startsAt: "2026-12-10T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" })
      .expect(400);
  });

  it("supprimer une publicité retire aussi son image envoyée", async () => {
    const auth = await director();
    const uploaded = ads.find((a) => a.imageUrl.includes("/api/media/"))!;
    expect(files.files.size).toBe(1);
    await request(app).delete(`/api/admin/ads/${uploaded.id}`).set("authorization", auth).expect(204);
    expect(files.files.size).toBe(0);
    await request(app).delete(`/api/admin/ads/${uploaded.id}`).set("authorization", auth).expect(404);
  });

  it("le dispatcheur ne gère pas les publicités", async () => {
    const { issueToken } = await import("./auth.js");
    const auth = `Bearer ${issueToken(STRONG.adminSecret, Date.now(), "admin", "m1")}`;
    await request(app).get("/api/admin/ads").set("authorization", auth).expect(403);
    await request(app).post("/api/admin/ads").set("authorization", auth).send({ title: "X", imageUrl: "https://cdn.example/x.jpg" }).expect(403);
  });
});
