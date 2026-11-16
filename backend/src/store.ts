import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { moduleView, type ModuleState } from "./services.js";

// Boutiques en ligne (étape 1 : catalogue et validation). Un marchand de l'appli marchand ajoute ses produits,
// ses bannières (images et vidéos publicitaires en carrousel) et demande la mise en ligne de sa boutique.
// L'équipe la valide (pièce d'identité ou IFU, photos), choisit sa catégorie et sa facturation, comme pour les
// restaurants : commission en % par vente, ou 0 % et un abonnement mensuel.
// Les REVIEWED_FIRST premiers produits sont vérifiés par l'équipe ; ensuite le marchand publie librement.
// Tout dépend du module « Boutiques » (SHOP) de la page Services : coupé par défaut, rien n'est proposé.

export const STORE_CATEGORIES = [
  { key: "mode", label: "Mode", emoji: "👗" },
  { key: "beaute", label: "Beauté", emoji: "💄" },
  { key: "telephones", label: "Téléphones et électronique", emoji: "📱" },
  { key: "epicerie", label: "Épicerie et boissons", emoji: "🛒" },
  { key: "maison", label: "Maison et cuisine", emoji: "🏠" },
  { key: "enfants", label: "Enfants et bébé", emoji: "🧸" },
  { key: "sport", label: "Sport et loisirs", emoji: "⚽" },
  { key: "autres", label: "Autres", emoji: "🛍️" },
] as const;
export const CATEGORY_KEYS = STORE_CATEGORIES.map((c) => c.key) as unknown as [string, ...string[]];

export const STORE_STATUSES = ["NONE", "PENDING", "ONLINE", "REJECTED", "SUSPENDED"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];
export type Review = "PENDING" | "APPROVED" | "REJECTED";

export const REVIEWED_FIRST = 5;
export const DEFAULT_COMMISSION = 10;
export const MAX_PRODUCTS = 500;
export const MAX_PHOTOS = 5;
export const MAX_BANNERS = 8;

export const SHOP_CLOSED = "La vente en ligne n'est pas encore ouverte sur Zedeka.";

// État du module « Boutiques » : OFF (rien n'existe pour les marchands ni les clients), SOON (les marchands
// préparent leur boutique, les clients voient « Bientôt ») ou ON (vente ouverte, étape 2).
export async function shopModule(prisma: PrismaClient): Promise<ModuleState> {
  return (await moduleView(prisma, "SHOP"))?.state ?? "OFF";
}

// Un produit neuf : vérifié par l'équipe tant que la boutique n'a pas REVIEWED_FIRST produits acceptés.
export function initialReview(approved: number): Review {
  return approved >= REVIEWED_FIRST ? "APPROVED" : "PENDING";
}

// Après une modification : un produit refusé par l'équipe repasse toujours en vérification, même dans une
// boutique de confiance ; sinon une boutique de confiance garde ses produits publiés, et avant, un produit dont
// le nom, les photos ou la description changent repasse en vérification.
export function reviewAfterEdit(current: Review, approved: number, contentChanged: boolean): Review {
  if (current === "REJECTED") return "PENDING";
  if (approved >= REVIEWED_FIRST) return "APPROVED";
  if (contentChanged) return "PENDING";
  return current;
}

// Demande de mise en ligne possible au début ou après un refus.
export const canRequest = (status: string) => status === "NONE" || status === "REJECTED";

// Ce que l'équipe a vérifié (pièce ou IFU) et choisi (catégorie) ne change plus une fois la demande envoyée :
// le marchand passe par Zedeka. Renvoie le message d'erreur, ou null si rien de verrouillé ne change.
export function lockedStoreChange(status: string, current: { storeIdNumber: string | null; storeCategory: string | null }, input: { storeIdNumber?: string; storeCategory?: string }): string | null {
  if (canRequest(status)) return null;
  if (input.storeIdNumber !== undefined && input.storeIdNumber !== (current.storeIdNumber ?? "")) return "Boutique déjà examinée : contactez Zedeka pour changer la pièce ou l'IFU";
  if (input.storeCategory !== undefined && input.storeCategory !== current.storeCategory) return "Boutique déjà examinée : contactez Zedeka pour changer la catégorie";
  return null;
}

// Facturation comme les restaurants : un taux de 0 % avec un abonnement veut dire « abonnement mensuel ».
export function billingOf(rate: number, fee: number | null): { mode: "COMMISSION" | "SUBSCRIPTION"; rate: number; fee: number | null } {
  return rate === 0 && fee ? { mode: "SUBSCRIPTION", rate: 0, fee } : { mode: "COMMISSION", rate, fee: null };
}

// Part de Zedeka sur une vente (arrondie au franc), et ce qui revient au marchand.
export function saleSplit(amount: number, rate: number) {
  const commission = Math.round((amount * rate) / 100);
  return { commission, net: amount - commission };
}

// Adresse de la page publique : nom en minuscules sans accents ni signes, « awa-couture ».
export function slugify(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "boutique";
}

export async function uniqueSlug(prisma: PrismaClient, name: string, merchantId: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.merchant.findFirst({ where: { storeSlug: slug, NOT: { id: merchantId } }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${merchantId.slice(-6)}`;
}

// Lecture sûre des colonnes JSON (une valeur abîmée ne casse pas la boutique).
export function readJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    const v = raw ? JSON.parse(raw) : fallback;
    return Array.isArray(fallback) && !Array.isArray(v) ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export type ProductOption = { name: string; values: string[] };

const text = (max: number) => z.string().trim().max(max);
const url = z
  .string()
  .trim()
  .max(500)
  .url("Lien invalide")
  .refine((u) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), "Lien https:// attendu");

export const productInput = z.object({
  name: text(80).min(2, "Nom trop court"),
  description: text(1000).optional().transform((v) => v || null),
  price: z.number().int().min(50, "Prix trop bas").max(10_000_000, "Prix trop élevé"),
  stock: z.number().int().min(0, "Stock positif").max(100_000),
  section: text(40).default(""),
  // Tailles, couleurs… : 3 listes au plus, 20 choix chacune.
  options: z
    .array(z.object({ name: text(20).min(1, "Nom du choix manquant"), values: z.array(text(24).min(1)).min(1, "Ajoutez au moins une valeur").max(20) }))
    .max(3)
    .default([]),
  imageUrls: z.array(url).min(1, "Ajoutez au moins une photo du produit").max(MAX_PHOTOS, `${MAX_PHOTOS} photos au plus`),
  visible: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productInput>;

export const storeInput = z.object({
  storeCategory: z.enum(CATEGORY_KEYS, { errorMap: () => ({ message: "Choisissez une catégorie" }) }),
  storeDescription: text(300).optional().transform((v) => v || null),
  storeLogoUrl: z.union([url, z.literal("").transform(() => null), z.null()]).optional(),
  storeIdNumber: text(40).min(4, "Numéro de pièce ou IFU trop court"),
});

export const bannerInput = z.object({
  kind: z.enum(["IMAGE", "VIDEO"]).default("IMAGE"),
  url,
  posterUrl: z.union([url, z.literal("").transform(() => null), z.null()]).optional(),
  title: text(80).default(""),
  productId: z.union([z.string().min(1), z.null()]).optional(),
  active: z.boolean().default(true),
});

export const productSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
  stock: true,
  section: true,
  options: true,
  imageUrls: true,
  visible: true,
  review: true,
  reviewNote: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

export const productView = (p: ProductRow) => ({
  ...p,
  options: readJson<ProductOption[]>(p.options, []),
  imageUrls: readJson<string[]>(p.imageUrls, []),
  // Ce que voit le client (étape 2) : accepté, montré par le marchand ; épuisé s'il n'y a plus de stock.
  published: p.review === "APPROVED" && p.visible,
  soldOut: p.stock <= 0,
});

export const bannerSelect = { id: true, kind: true, url: true, posterUrl: true, title: true, productId: true, position: true, active: true } satisfies Prisma.StoreBannerSelect;

export const storeSelect = {
  storeStatus: true,
  storeSlug: true,
  storeCategory: true,
  storeDescription: true,
  storeLogoUrl: true,
  storeIdNumber: true,
  storeCommissionRate: true,
  storeSubscriptionFee: true,
  storeRequestedAt: true,
  storeReviewedAt: true,
  storeNote: true,
} satisfies Prisma.MerchantSelect;
type StoreRow = Prisma.MerchantGetPayload<{ select: typeof storeSelect }>;

export const storeView = (s: StoreRow) => ({
  status: s.storeStatus as StoreStatus,
  slug: s.storeSlug,
  category: s.storeCategory,
  description: s.storeDescription,
  logoUrl: s.storeLogoUrl,
  idNumber: s.storeIdNumber,
  billing: billingOf(s.storeCommissionRate, s.storeSubscriptionFee),
  requestedAt: s.storeRequestedAt,
  reviewedAt: s.storeReviewedAt,
  note: s.storeNote,
});

// Nombre de produits par état de vérification (hors produits supprimés).
export async function productCounts(prisma: PrismaClient, merchantId: string) {
  const rows = await prisma.product.groupBy({ by: ["review"], where: { merchantId, archivedAt: null }, _count: { _all: true } });
  const n = (r: Review) => rows.find((x) => x.review === r)?._count._all ?? 0;
  return { total: n("PENDING") + n("APPROVED") + n("REJECTED"), pending: n("PENDING"), approved: n("APPROVED"), rejected: n("REJECTED") };
}
