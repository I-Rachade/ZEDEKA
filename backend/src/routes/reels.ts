import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireCustomer, revokedLongToken } from "../auth.js";
import type { FileStore } from "../storage.js";
import { webUrl } from "../util.js";
import { linkedCustomerId } from "./customer.js";
import { rawImage, rawVideo, storeMenuImage, storeVideo } from "./menuImages.js";
import { HttpError, write } from "./adminWrite.js";
import { liveAdsWhere } from "./ads.js";

// Onglet « Nouveautés » de l'appli client : courtes vidéos de produits (5 à 7 s) que le client fait défiler,
// comme sur un réseau social. Il aime, commente et commande directement : la vidéo mène à un plat d'un
// restaurant, à un produit d'une boutique en ligne ou à un lien. L'équipe les ajoute dans l'admin.

// Vidéos et affiches rangées à part : /api/media/store-videos/nouveautes/… et /api/media/menu-images/nouveautes/…
const FOLDER = "nouveautes";
export const PAGE_SIZE = 20;
export const COMMENT_MAX = 300;
const COMMENTS_SHOWN = 100;

const link = z.union([z.string().trim().regex(/^\/(?!\/)[^\s]{0,300}$/, "lien invalide"), webUrl]).nullable();
const date = z.coerce.date().nullable();
const id = z.string().trim().min(1).max(64).nullable();

export const reelInput = z.object({
  title: z.string().trim().min(2).max(80),
  caption: z.string().trim().max(200).nullable().default(null),
  videoUrl: webUrl,
  posterUrl: webUrl.nullable().default(null),
  menuItemId: id.default(null),
  productId: id.default(null),
  linkUrl: link.default(null),
  position: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
  startsAt: date.default(null),
  endsAt: date.default(null),
});

export const commentInput = z.object({ text: z.string().trim().min(1, "Écrivez un commentaire").max(COMMENT_MAX, `${COMMENT_MAX} caractères au plus`) });

// Une seule destination pour « Commander » : un plat, un produit, ou à défaut un lien.
export function checkTarget(t: { menuItemId?: string | null; productId?: string | null }) {
  if (t.menuItemId && t.productId) throw new HttpError(400, "Choisissez un plat ou un produit, pas les deux");
}

function checkPeriod(startsAt: Date | null, endsAt: Date | null) {
  if (startsAt && endsAt && startsAt >= endsAt) throw new HttpError(400, "La date de fin doit suivre la date de début");
}

type TargetRow = {
  linkUrl: string | null;
  menuItem: { id: string; name: string; price: number; available: boolean; restaurant: { slug: string; name: string; active: boolean } } | null;
  product: {
    id: string;
    name: string;
    price: number;
    stock: number;
    visible: boolean;
    review: string;
    archivedAt: Date | null;
    merchant: { storeSlug: string | null; shopName: string; storeStatus: string };
  } | null;
};

export type ReelOrder = { kind: "DISH" | "PRODUCT" | "LINK"; href: string; price: number | null; seller: string | null; available: boolean };

// Où mène « Commander », et si c'est possible maintenant (plat disponible, produit en ligne et en stock).
export function orderOf(r: TargetRow): ReelOrder | null {
  if (r.menuItem) {
    const m = r.menuItem;
    return {
      kind: "DISH",
      href: `/r/${m.restaurant.slug}?plat=${m.id}`,
      price: m.price,
      seller: m.restaurant.name,
      available: m.available && m.restaurant.active,
    };
  }
  if (r.product) {
    const p = r.product;
    const online = p.merchant.storeStatus === "ONLINE" && !!p.merchant.storeSlug;
    return {
      kind: "PRODUCT",
      href: online ? `/app/boutiques/${p.merchant.storeSlug}?produit=${p.id}` : "/app/boutiques",
      price: p.price,
      seller: p.merchant.shopName,
      available: online && p.visible && p.review === "APPROVED" && !p.archivedAt && p.stock > 0,
    };
  }
  if (r.linkUrl) return { kind: "LINK", href: r.linkUrl, price: null, seller: null, available: true };
  return null;
}

const targetSelect = {
  linkUrl: true,
  menuItem: { select: { id: true, name: true, price: true, available: true, restaurant: { select: { slug: true, name: true, active: true } } } },
  product: {
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      visible: true,
      review: true,
      archivedAt: true,
      merchant: { select: { storeSlug: true, shopName: true, storeStatus: true } },
    },
  },
} as const;

// Prénom seul sous un commentaire (« Ama K. »), jamais le numéro.
export function authorName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Client Zedeka";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

async function liveReel(prisma: PrismaClient, reelId: string) {
  return prisma.reel.findFirst({ where: { id: reelId, ...liveAdsWhere(new Date()) }, select: { id: true } });
}

async function recount(prisma: PrismaClient, reelId: string) {
  const [likes, comments] = await Promise.all([prisma.reelLike.count({ where: { reelId } }), prisma.reelComment.count({ where: { reelId, hidden: false } })]);
  return prisma.reel.update({ where: { id: reelId }, data: { likeCount: likes, commentCount: comments }, select: { likeCount: true, commentCount: true } });
}

export function publicReelsRouter(prisma: PrismaClient, config: { secret: string }) {
  const router = Router();
  const auth = requireCustomer(config.secret);

  // Client connecté et toujours valide (compte non supprimé, session non révoquée).
  async function customer(req: Request, res: Response): Promise<string | null> {
    const c = await prisma.customer.findUnique({ where: { id: res.locals.customerId }, select: { deletedAt: true, sessionsValidFrom: true } });
    if (!c || c.deletedAt || revokedLongToken(req, config.secret, c.sessionsValidFrom)) {
      res.status(401).json({ error: "Connexion requise" });
      return null;
    }
    return res.locals.customerId as string;
  }

  // Le fil : vidéos en ligne dans l'ordre choisi, par pages (?apres=<id> de la dernière vue).
  router.get("/reels", async (req, res) => {
    const me = await linkedCustomerId(prisma, req, config.secret);
    const after = typeof req.query.apres === "string" ? req.query.apres : null;
    const rows = await prisma.reel.findMany({
      where: liveAdsWhere(new Date()),
      orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      take: PAGE_SIZE + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true, title: true, caption: true, videoUrl: true, posterUrl: true, likeCount: true, commentCount: true, ...targetSelect },
    });
    const page = rows.slice(0, PAGE_SIZE);
    const liked = me && page.length ? new Set((await prisma.reelLike.findMany({ where: { customerId: me, reelId: { in: page.map((r) => r.id) } }, select: { reelId: true } })).map((l) => l.reelId)) : new Set<string>();
    res.set("Cache-Control", "private, no-store");
    res.json({
      reels: page.map((r) => ({
        id: r.id,
        title: r.title,
        caption: r.caption,
        videoUrl: r.videoUrl,
        posterUrl: r.posterUrl,
        likeCount: r.likeCount,
        commentCount: r.commentCount,
        liked: liked.has(r.id),
        order: orderOf(r),
      })),
      next: rows.length > PAGE_SIZE ? page[page.length - 1].id : null,
    });
  });

  // « J'aime » : PUT pour aimer, DELETE pour retirer. Sans effet s'il est déjà dans cet état.
  router.put("/reels/:id/like", auth, async (req, res) => {
    const me = await customer(req, res);
    if (!me) return;
    if (!(await liveReel(prisma, String(req.params.id)))) return void res.status(404).json({ error: "Vidéo introuvable" });
    const already = await prisma.reelLike.findUnique({ where: { reelId_customerId: { reelId: String(req.params.id), customerId: me } }, select: { id: true } });
    if (!already) await prisma.reelLike.create({ data: { reelId: String(req.params.id), customerId: me } }).catch(() => {});
    const counts = await recount(prisma, String(req.params.id));
    res.json({ liked: true, likeCount: counts.likeCount });
  });

  router.delete("/reels/:id/like", auth, async (req, res) => {
    const me = await customer(req, res);
    if (!me) return;
    if (!(await prisma.reel.findUnique({ where: { id: String(req.params.id) }, select: { id: true } }))) return void res.status(404).json({ error: "Vidéo introuvable" });
    await prisma.reelLike.deleteMany({ where: { reelId: String(req.params.id), customerId: me } });
    const counts = await recount(prisma, String(req.params.id));
    res.json({ liked: false, likeCount: counts.likeCount });
  });

  // Commentaires visibles, du plus récent au plus ancien ; « mine » permet au client de supprimer les siens.
  router.get("/reels/:id/comments", async (req, res) => {
    const me = await linkedCustomerId(prisma, req, config.secret);
    const rows = await prisma.reelComment.findMany({
      where: { reelId: String(req.params.id), hidden: false },
      orderBy: { createdAt: "desc" },
      take: COMMENTS_SHOWN,
      select: { id: true, text: true, createdAt: true, customerId: true, customer: { select: { name: true } } },
    });
    res.set("Cache-Control", "private, no-store");
    res.json(rows.map((c) => ({ id: c.id, text: c.text, createdAt: c.createdAt, author: authorName(c.customer.name), mine: c.customerId === me })));
  });

  router.post("/reels/:id/comments", auth, async (req, res) => {
    const me = await customer(req, res);
    if (!me) return;
    const parsed = commentInput.safeParse(req.body ?? {});
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Commentaire invalide" });
    if (!(await liveReel(prisma, String(req.params.id)))) return void res.status(404).json({ error: "Vidéo introuvable" });
    const c = await prisma.reelComment.create({
      data: { reelId: String(req.params.id), customerId: me, text: parsed.data.text },
      select: { id: true, text: true, createdAt: true, customer: { select: { name: true } } },
    });
    const counts = await recount(prisma, String(req.params.id));
    res.status(201).json({ comment: { id: c.id, text: c.text, createdAt: c.createdAt, author: authorName(c.customer.name), mine: true }, commentCount: counts.commentCount });
  });

  router.delete("/reels/:id/comments/:commentId", auth, async (req, res) => {
    const me = await customer(req, res);
    if (!me) return;
    const { count } = await prisma.reelComment.deleteMany({ where: { id: String(req.params.commentId), reelId: String(req.params.id), customerId: me } });
    if (!count) return void res.status(404).json({ error: "Commentaire introuvable" });
    const counts = await recount(prisma, String(req.params.id));
    res.json({ commentCount: counts.commentCount });
  });

  return router;
}

export function adminReelsRouter(prisma: PrismaClient, config: { files?: FileStore; frontendOrigin: string }) {
  const router = Router();

  router.get("/reels", async (_req, res) => {
    const rows = await prisma.reel.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        caption: true,
        videoUrl: true,
        posterUrl: true,
        menuItemId: true,
        productId: true,
        position: true,
        active: true,
        startsAt: true,
        endsAt: true,
        likeCount: true,
        commentCount: true,
        createdAt: true,
        ...targetSelect,
      },
    });
    res.json(
      rows.map(({ menuItem, product, ...r }) => ({
        ...r,
        targetName: menuItem?.name ?? product?.name ?? null,
        order: orderOf({ linkUrl: r.linkUrl, menuItem, product }),
      })),
    );
  });

  router.post("/reels/videos", rawVideo, async (req, res) => {
    if (!config.files) return void res.status(503).json({ error: "Envoi de vidéos indisponible" });
    await storeVideo(req, res, config.files, FOLDER, config.frontendOrigin);
  });

  router.post("/reels/images", rawImage, async (req, res) => {
    if (!config.files) return void res.status(503).json({ error: "Envoi de photos indisponible" });
    await storeMenuImage(req, res, config.files, FOLDER, config.frontendOrigin);
  });

  // Plats et produits à relier à une vidéo (recherche sur le nom, celui du restaurant ou de la boutique).
  router.get("/reels/targets", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    if (q.length < 2) return void res.json({ dishes: [], products: [] });
    const [dishes, products] = await Promise.all([
      prisma.menuItem.findMany({
        where: { OR: [{ name: { contains: q } }, { restaurant: { name: { contains: q } } }] },
        take: 15,
        orderBy: { name: "asc" },
        select: { id: true, name: true, price: true, available: true, restaurant: { select: { name: true } } },
      }),
      prisma.product.findMany({
        where: { archivedAt: null, OR: [{ name: { contains: q } }, { merchant: { shopName: { contains: q } } }] },
        take: 15,
        orderBy: { name: "asc" },
        select: { id: true, name: true, price: true, stock: true, merchant: { select: { shopName: true } } },
      }),
    ]);
    res.json({
      dishes: dishes.map((d) => ({ id: d.id, name: d.name, price: d.price, seller: d.restaurant.name, available: d.available })),
      products: products.map((p) => ({ id: p.id, name: p.name, price: p.price, seller: p.merchant.shopName, available: p.stock > 0 })),
    });
  });

  async function checkRefs(data: { menuItemId?: string | null; productId?: string | null }) {
    checkTarget(data);
    if (data.menuItemId && !(await prisma.menuItem.findUnique({ where: { id: data.menuItemId }, select: { id: true } }))) throw new HttpError(400, "Plat introuvable");
    if (data.productId && !(await prisma.product.findUnique({ where: { id: data.productId }, select: { id: true } }))) throw new HttpError(400, "Produit introuvable");
  }

  router.post(
    "/reels",
    write(reelInput, async (data) => {
      checkPeriod(data.startsAt, data.endsAt);
      await checkRefs(data);
      return prisma.reel.create({ data });
    }),
  );

  router.patch(
    "/reels/:id",
    write(
      reelInput,
      async (data, reelId) => {
        const current = await prisma.reel.findUnique({ where: { id: reelId } });
        if (!current) throw new HttpError(404, "Vidéo introuvable");
        checkPeriod(data.startsAt === undefined ? current.startsAt : data.startsAt, data.endsAt === undefined ? current.endsAt : data.endsAt);
        // Choisir un plat retire le produit, et l'inverse : une seule destination.
        const next = { ...data };
        if (data.menuItemId) next.productId = null;
        if (data.productId) next.menuItemId = null;
        await checkRefs(next);
        return prisma.reel.update({ where: { id: reelId }, data: next });
      },
      { partial: true },
    ),
  );

  router.delete("/reels/:id", async (req, res) => {
    const reel = await prisma.reel.findUnique({ where: { id: String(req.params.id) } });
    if (!reel) return void res.status(404).json({ error: "Vidéo introuvable" });
    await prisma.reel.delete({ where: { id: reel.id } });
    // Vidéo et affiche envoyées depuis l'appareil : retirées du stockage (un lien externe reste tel quel).
    if (config.files) {
      const keys = [reel.videoUrl, reel.posterUrl].map((u) => u?.match(/\/api\/media\/((?:store-videos|menu-images)\/nouveautes\/[0-9a-f-]{36}\.(?:mp4|webm|jpg|png|webp))$/)?.[1]).filter((k): k is string => !!k);
      await Promise.all(keys.map((k) => config.files!.delete(k).catch(() => {})));
    }
    res.status(204).end();
  });

  // Modération : tous les commentaires d'une vidéo, masqués compris.
  router.get("/reels/:id/comments", async (req, res) => {
    const rows = await prisma.reelComment.findMany({
      where: { reelId: String(req.params.id) },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, text: true, hidden: true, createdAt: true, customer: { select: { name: true, phone: true } } },
    });
    res.json(rows.map((c) => ({ id: c.id, text: c.text, hidden: c.hidden, createdAt: c.createdAt, author: c.customer.name ?? "—", phone: c.customer.phone.startsWith("supprime:") ? null : c.customer.phone })));
  });

  router.patch("/reels/:id/comments/:commentId", async (req, res) => {
    const parsed = z.object({ hidden: z.boolean() }).safeParse(req.body ?? {});
    if (!parsed.success) return void res.status(400).json({ error: "Valeur invalide" });
    const { count } = await prisma.reelComment.updateMany({ where: { id: String(req.params.commentId), reelId: String(req.params.id) }, data: { hidden: parsed.data.hidden } });
    if (!count) return void res.status(404).json({ error: "Commentaire introuvable" });
    const counts = await recount(prisma, String(req.params.id));
    res.json({ hidden: parsed.data.hidden, commentCount: counts.commentCount });
  });

  router.delete("/reels/:id/comments/:commentId", async (req, res) => {
    const { count } = await prisma.reelComment.deleteMany({ where: { id: String(req.params.commentId), reelId: String(req.params.id) } });
    if (!count) return void res.status(404).json({ error: "Commentaire introuvable" });
    const counts = await recount(prisma, String(req.params.id));
    res.json({ commentCount: counts.commentCount });
  });

  return router;
}
