import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { CUSTOMER_TOKEN_TTL_MS, issueToken } from "./auth.js";
import { authorName, checkTarget, commentInput, COMMENT_MAX, orderOf } from "./routes/reels.js";
import { memoryStore } from "./storage.js";

const SECRET = "a".repeat(64);
const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: SECRET };
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0]);

const dish = { id: "d1", name: "Poulet braisé", price: 3500, available: true, restaurant: { slug: "chez-ama", name: "Chez Ama", active: true } };
const product = {
  id: "p1",
  name: "Robe wax",
  price: 12_500,
  stock: 3,
  visible: true,
  review: "APPROVED",
  archivedAt: null as Date | null,
  merchant: { storeSlug: "mode-afi", shopName: "Mode Afi", storeStatus: "ONLINE" },
};

describe("nouveautés : où mène « Commander »", () => {
  it("un plat ouvre sa fiche sur la carte du restaurant", () => {
    expect(orderOf({ linkUrl: null, menuItem: dish, product: null })).toEqual({ kind: "DISH", href: "/r/chez-ama?plat=d1", price: 3500, seller: "Chez Ama", available: true });
    expect(orderOf({ linkUrl: null, menuItem: { ...dish, available: false }, product: null })?.available).toBe(false);
    expect(orderOf({ linkUrl: null, menuItem: { ...dish, restaurant: { ...dish.restaurant, active: false } }, product: null })?.available).toBe(false);
  });

  it("un produit ouvre sa fiche dans la boutique, s'il est en ligne et en stock", () => {
    expect(orderOf({ linkUrl: null, menuItem: null, product })).toMatchObject({ kind: "PRODUCT", href: "/app/boutiques/mode-afi?produit=p1", available: true });
    expect(orderOf({ linkUrl: null, menuItem: null, product: { ...product, stock: 0 } })?.available).toBe(false);
    expect(orderOf({ linkUrl: null, menuItem: null, product: { ...product, review: "PENDING" } })?.available).toBe(false);
    const closed = orderOf({ linkUrl: null, menuItem: null, product: { ...product, merchant: { ...product.merchant, storeStatus: "SUSPENDED" } } });
    expect(closed).toMatchObject({ href: "/app/boutiques", available: false });
  });

  it("sinon le lien, et rien sans destination", () => {
    expect(orderOf({ linkUrl: "/colis", menuItem: null, product: null })).toEqual({ kind: "LINK", href: "/colis", price: null, seller: null, available: true });
    expect(orderOf({ linkUrl: null, menuItem: null, product: null })).toBeNull();
    expect(() => checkTarget({ menuItemId: "d1", productId: "p1" })).toThrow();
  });

  it("le commentaire montre le prénom et l'initiale, jamais le numéro", () => {
    expect(authorName("Ama Koffi Mensah")).toBe("Ama M.");
    expect(authorName("Kodjo")).toBe("Kodjo");
    expect(authorName(null)).toBe("Client Zedeka");
    expect(commentInput.safeParse({ text: "  " }).success).toBe(false);
    expect(commentInput.safeParse({ text: "x".repeat(COMMENT_MAX + 1) }).success).toBe(false);
    expect(commentInput.safeParse({ text: "Ça a l'air délicieux !" }).success).toBe(true);
  });
});

type Reel = { id: string; title: string; caption: string | null; videoUrl: string; posterUrl: string | null; linkUrl: string | null; menuItemId: string | null; productId: string | null; position: number; active: boolean; startsAt: Date | null; endsAt: Date | null; likeCount: number; commentCount: number; createdAt: Date };
type Like = { id: string; reelId: string; customerId: string };
type Comment = { id: string; reelId: string; customerId: string; text: string; hidden: boolean; createdAt: Date };

// Faux Prisma : juste ce que les routes des nouveautés utilisent.
function fakePrisma() {
  const reels: Reel[] = [];
  const likes: Like[] = [];
  const comments: Comment[] = [];
  const customers = [
    { id: "c1", name: "Ama Koffi", phone: "+22890000001", deletedAt: null, sessionsValidFrom: null },
    { id: "c2", name: "Kodjo", phone: "+22890000002", deletedAt: null, sessionsValidFrom: null },
  ];
  let n = 0;
  const live = (r: Reel) => r.active && (!r.startsAt || r.startsAt <= new Date()) && (!r.endsAt || r.endsAt > new Date());
  const withTarget = (r: Reel) => ({ ...r, menuItem: r.menuItemId === "d1" ? dish : null, product: null });
  const match = (c: Comment, w: Partial<Comment>) => Object.entries(w).every(([k, v]) => (c as Record<string, unknown>)[k] === v);
  const prisma = {
    reel: {
      findMany: async ({ where }: { where?: { active?: boolean } } = {}) =>
        reels.filter((r) => (where?.active ? live(r) : true)).sort((a, b) => a.position - b.position).map(withTarget),
      findFirst: async ({ where }: { where: { id: string } }) => reels.find((r) => r.id === where.id && live(r)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => reels.find((r) => r.id === where.id) ?? null,
      create: async ({ data }: { data: Partial<Reel> }) => {
        const r = { likeCount: 0, commentCount: 0, createdAt: new Date(), ...data, id: `r${++n}` } as Reel;
        reels.push(r);
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Reel> }) => Object.assign(reels.find((r) => r.id === where.id)!, data),
      delete: async ({ where }: { where: { id: string } }) => reels.splice(reels.findIndex((r) => r.id === where.id), 1)[0],
    },
    reelLike: {
      findUnique: async ({ where }: { where: { reelId_customerId: { reelId: string; customerId: string } } }) =>
        likes.find((l) => l.reelId === where.reelId_customerId.reelId && l.customerId === where.reelId_customerId.customerId) ?? null,
      findMany: async ({ where }: { where: { customerId: string; reelId: { in: string[] } } }) => likes.filter((l) => l.customerId === where.customerId && where.reelId.in.includes(l.reelId)),
      create: async ({ data }: { data: Omit<Like, "id"> }) => likes.push({ ...data, id: `l${++n}` }),
      deleteMany: async ({ where }: { where: Partial<Like> }) => {
        const before = likes.length;
        for (let i = likes.length - 1; i >= 0; i--) if (likes[i].reelId === where.reelId && likes[i].customerId === where.customerId) likes.splice(i, 1);
        return { count: before - likes.length };
      },
      count: async ({ where }: { where: { reelId: string } }) => likes.filter((l) => l.reelId === where.reelId).length,
    },
    reelComment: {
      findMany: async ({ where }: { where: Partial<Comment> }) =>
        comments
          .filter((c) => match(c, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((c) => ({ ...c, customer: customers.find((x) => x.id === c.customerId)! })),
      create: async ({ data }: { data: Omit<Comment, "id" | "hidden" | "createdAt"> }) => {
        const c = { ...data, id: `m${++n}`, hidden: false, createdAt: new Date(Date.now() + n) };
        comments.push(c);
        return { ...c, customer: customers.find((x) => x.id === c.customerId)! };
      },
      updateMany: async ({ where, data }: { where: Partial<Comment>; data: Partial<Comment> }) => {
        const hit = comments.filter((c) => match(c, where));
        hit.forEach((c) => Object.assign(c, data));
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: Partial<Comment> }) => {
        const before = comments.length;
        for (let i = comments.length - 1; i >= 0; i--) if (match(comments[i], where)) comments.splice(i, 1);
        return { count: before - comments.length };
      },
      count: async ({ where }: { where: Partial<Comment> }) => comments.filter((c) => match(c, where)).length,
    },
    menuItem: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "d1" ? { id: "d1" } : null) },
    product: { findUnique: async () => null },
    customer: { findUnique: async ({ where }: { where: { id: string } }) => customers.find((c) => c.id === where.id) ?? null },
    teamMember: { findUnique: async () => null },
  } as unknown as PrismaClient;
  return { prisma, reels, comments };
}

describe("nouveautés : fil, « j'aime » et commentaires", () => {
  const { prisma, reels } = fakePrisma();
  const files = memoryStore();
  const app = createApp(prisma, { frontendOrigin: "https://zedeka.example", zedekaWhatsapp: "", files, ...STRONG });
  const director = async () => `Bearer ${(await request(app).post("/api/admin/login").send({ password: STRONG.adminPassword }).expect(200)).body.token}`;
  const client = (id: string) => ({ authorization: `Bearer ${issueToken(SECRET, Date.now(), "customer", id, CUSTOMER_TOKEN_TTL_MS)}` });

  it("l'équipe envoie une vidéo et la relie à un plat ; le client la voit avec « Commander »", async () => {
    const auth = await director();
    const video = await request(app).post("/api/admin/reels/videos").set("authorization", auth).set("content-type", "video/mp4").send(MP4).expect(201);
    expect(video.body.url).toMatch(/^https:\/\/zedeka\.example\/api\/media\/store-videos\/nouveautes\/[0-9a-f-]{36}\.mp4$/);
    await request(app).post("/api/admin/reels").set("authorization", auth).send({ title: "Poulet braisé", videoUrl: video.body.url, menuItemId: "d1", productId: "p1" }).expect(400);
    await request(app).post("/api/admin/reels").set("authorization", auth).send({ title: "Poulet braisé", videoUrl: video.body.url, menuItemId: "inconnu" }).expect(400);
    await request(app).post("/api/admin/reels").set("authorization", auth).send({ title: "Poulet braisé", caption: "Braisé au feu de bois", videoUrl: video.body.url, menuItemId: "d1" }).expect(201);
    await request(app).post("/api/admin/reels").set("authorization", auth).send({ title: "Cachée", videoUrl: video.body.url, active: false }).expect(201);

    const feed = await request(app).get("/api/reels").expect(200);
    expect(feed.body.reels).toHaveLength(1);
    expect(feed.body.reels[0]).toMatchObject({ title: "Poulet braisé", liked: false, likeCount: 0, order: { kind: "DISH", href: "/r/chez-ama?plat=d1", price: 3500 } });
  });

  it("aimer et commenter demandent un compte", async () => {
    const id = reels[0].id;
    await request(app).put(`/api/reels/${id}/like`).expect(401);
    await request(app).post(`/api/reels/${id}/comments`).send({ text: "Miam" }).expect(401);
  });

  it("le client aime une fois, puis retire son « j'aime »", async () => {
    const id = reels[0].id;
    expect((await request(app).put(`/api/reels/${id}/like`).set(client("c1")).expect(200)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await request(app).put(`/api/reels/${id}/like`).set(client("c1")).expect(200)).body.likeCount).toBe(1);
    await request(app).put(`/api/reels/${id}/like`).set(client("c2")).expect(200);
    const feed = await request(app).get("/api/reels").set(client("c1")).expect(200);
    expect(feed.body.reels[0]).toMatchObject({ liked: true, likeCount: 2 });
    expect((await request(app).delete(`/api/reels/${id}/like`).set(client("c1")).expect(200)).body).toEqual({ liked: false, likeCount: 1 });
    // Vidéo masquée : on ne peut plus l'aimer.
    await request(app).put(`/api/reels/${reels[1].id}/like`).set(client("c1")).expect(404);
  });

  it("commentaires : le client écrit et supprime le sien, l'équipe masque les autres", async () => {
    const id = reels[0].id;
    const auth = await director();
    const mine = await request(app).post(`/api/reels/${id}/comments`).set(client("c1")).send({ text: "Ça a l'air délicieux !" }).expect(201);
    expect(mine.body).toMatchObject({ comment: { author: "Ama K.", mine: true }, commentCount: 1 });
    const other = await request(app).post(`/api/reels/${id}/comments`).set(client("c2")).send({ text: "Pub déplacée" }).expect(201);
    await request(app).post(`/api/reels/${id}/comments`).set(client("c2")).send({ text: " " }).expect(400);

    const list = await request(app).get(`/api/reels/${id}/comments`).set(client("c1")).expect(200);
    expect(list.body.map((c: { text: string; mine: boolean }) => [c.text, c.mine])).toEqual([
      ["Pub déplacée", false],
      ["Ça a l'air délicieux !", true],
    ]);
    // Le commentaire d'un autre ne se supprime pas.
    await request(app).delete(`/api/reels/${id}/comments/${other.body.comment.id}`).set(client("c1")).expect(404);

    expect((await request(app).patch(`/api/admin/reels/${id}/comments/${other.body.comment.id}`).set("authorization", auth).send({ hidden: true }).expect(200)).body.commentCount).toBe(1);
    expect((await request(app).get(`/api/reels/${id}/comments`).expect(200)).body).toHaveLength(1);
    expect((await request(app).get(`/api/admin/reels/${id}/comments`).set("authorization", auth).expect(200)).body).toHaveLength(2);

    expect((await request(app).delete(`/api/reels/${id}/comments/${mine.body.comment.id}`).set(client("c1")).expect(200)).body.commentCount).toBe(0);
  });

  it("supprimer la vidéo retire aussi le fichier envoyé", async () => {
    const auth = await director();
    const key = reels[0].videoUrl.split("/api/media/")[1];
    expect(await files.get(key)).not.toBeNull();
    await request(app).delete(`/api/admin/reels/${reels[0].id}`).set("authorization", auth).expect(204);
    expect(await files.get(key)).toBeNull();
    expect((await request(app).get("/api/reels").expect(200)).body.reels).toHaveLength(0);
  });
});
