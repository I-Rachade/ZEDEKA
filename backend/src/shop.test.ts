import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { canDriverMove } from "./driver.js";
import { merchantNet } from "./parcel.js";
import { invalidateServices } from "./services.js";
import { CartError, priceCart, pricesChanged, quantities, shopCommission, shopMove } from "./shop.js";

const robe = { id: "p1", name: "Robe wax", price: 12_500, stock: 3, options: JSON.stringify([{ name: "Taille", values: ["S", "M"] }]), imageUrls: '["https://x/a.jpg"]', visible: true, review: "APPROVED", archivedAt: null };
const sac = { id: "p2", name: "Sac", price: 8_000, stock: 1, options: "[]", imageUrls: "[]", visible: true, review: "APPROVED", archivedAt: null };

describe("boutiques en ligne : panier", () => {
  it("prix, choix et regroupement des lignes", () => {
    const cart = priceCart(
      [
        { productId: "p1", quantity: 1, choice: { Taille: "M" } },
        { productId: "p1", quantity: 1, choice: { Taille: "M" } },
        { productId: "p2", quantity: 1, choice: {} },
      ],
      [robe, sac],
    );
    expect(cart.subtotal).toBe(33_000);
    expect(cart.lines).toHaveLength(2);
    expect(cart.lines[0]).toMatchObject({ choice: "Taille : M", quantity: 2, imageUrl: "https://x/a.jpg" });
    expect([...quantities(cart.lines)]).toEqual([
      ["p1", 2],
      ["p2", 1],
    ]);
  });

  it("refuse un choix manquant, un stock insuffisant ou un produit retiré", () => {
    expect(() => priceCart([{ productId: "p1", quantity: 1, choice: {} }], [robe])).toThrow(CartError);
    expect(() => priceCart([{ productId: "p1", quantity: 1, choice: { Taille: "XL" } }], [robe])).toThrow("choisissez taille");
    // Le stock vaut pour toutes les lignes du produit, quel que soit le choix.
    expect(() => priceCart([{ productId: "p1", quantity: 2, choice: { Taille: "S" } }, { productId: "p1", quantity: 2, choice: { Taille: "M" } }], [robe])).toThrow("plus que 3");
    expect(() => priceCart([{ productId: "p2", quantity: 1, choice: {} }], [{ ...sac, stock: 0 }])).toThrow("épuisé");
    expect(() => priceCart([{ productId: "p2", quantity: 1, choice: {} }], [{ ...sac, review: "PENDING" }])).toThrow("plus en vente");
    expect(() => priceCart([{ productId: "p2", quantity: 1, choice: {} }], [{ ...sac, archivedAt: new Date() }])).toThrow("plus en vente");
  });
});

describe("boutiques en ligne : vente", () => {
  it("le marchand accepte, déclare prêt ou refuse avant le départ du paquet", () => {
    expect(shopMove("PENDING", "accept")).toBe("CONFIRMED");
    expect(shopMove("CONFIRMED", "accept")).toBeNull();
    expect(shopMove("CONFIRMED", "ready")).toBe("READY");
    expect(shopMove("PENDING", "ready")).toBeNull();
    expect(shopMove("PENDING", "refuse")).toBe("CANCELLED");
    expect(shopMove("READY", "refuse")).toBeNull();
    expect(shopMove("PICKED_UP", "refuse")).toBeNull();
  });

  it("le livreur ne récupère le paquet qu'une fois prêt", () => {
    expect(canDriverMove("PARCEL", "PENDING", "PICKED_UP", true)).toBe(false);
    expect(canDriverMove("PARCEL", "CONFIRMED", "PICKED_UP", true)).toBe(false);
    expect(canDriverMove("PARCEL", "READY", "PICKED_UP", true)).toBe(true);
    // Colis classique : dès la demande, comme avant.
    expect(canDriverMove("PARCEL", "PENDING", "PICKED_UP")).toBe(true);
  });

  it("le marchand touche les articles moins la part de Zedeka, en espèces comme en mobile money", () => {
    const sale = { storeSale: true, subtotal: 20_000, commission: shopCommission(20_000, 10), deliveryFee: 1_000, extraFee: 0, discount: 0, total: 21_000 };
    expect(merchantNet({ ...sale, cashCollected: 21_000 })).toBe(18_000);
    // Mobile money : rien encaissé par le livreur, le total compte.
    expect(merchantNet({ ...sale, cashCollected: null })).toBe(18_000);
    // Abonnement : pas de commission.
    expect(merchantNet({ ...sale, commission: 0, cashCollected: null })).toBe(20_000);
  });

  it("espèces manquantes à la livraison : retenues au marchand, comme pour un colis", () => {
    const sale = { storeSale: true, subtotal: 20_000, commission: 2_000, deliveryFee: 1_000, extraFee: 0, discount: 0, total: 21_000 };
    expect(merchantNet({ ...sale, cashCollected: 19_000 })).toBe(16_000);
    // Remise accordée par l'équipe : elle baisse le total, pas ce que touche le marchand.
    expect(merchantNet({ ...sale, discount: 500, total: 20_500, cashCollected: 20_500 })).toBe(18_000);
  });

  it("commande refusée si les prix affichés au client ont changé", () => {
    expect(pricesChanged(undefined, 33_000)).toBe(false);
    expect(pricesChanged(33_000, 33_000)).toBe(false);
    expect(pricesChanged(30_000, 33_000)).toBe(true);
  });
});

describe("rubrique « Boutiques » côté client", () => {
  beforeEach(() => invalidateServices());
  const config = { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  const prisma = (state: string, commerces: unknown[] = []) =>
    ({
      serviceModule: { findMany: async () => [{ code: "SHOP", state, sortOrder: 70 }] },
      settings: { findFirst: async () => ({ id: 1, zedEnabled: false, zedButtonColor: "SUN" }) },
      merchant: { findMany: async () => [], findFirst: async () => null },
      restaurant: { findMany: async () => commerces },
    }) as unknown as PrismaClient;

  it("fermée tant que le module n'est pas ouvert", async () => {
    const app = createApp(prisma("SOON"), config);
    await request(app).get("/api/shops").expect(404);
    await request(app).get("/api/shops/awa-couture").expect(404);
  });

  it("ouverte : liste, et commande réservée aux clients connectés", async () => {
    const app = createApp(prisma("ON"), config);
    const res = await request(app).get("/api/shops").expect(200);
    expect(res.body.shops).toEqual([]);
    expect(res.body.categories.length).toBeGreaterThan(0);
    await request(app).post("/api/shops/awa-couture/orders").send({}).expect(401);
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

  it("commandes de la boutique : connexion du marchand obligatoire", async () => {
    const app = createApp({} as PrismaClient, config);
    await request(app).get("/api/marchand/shop-orders").expect(401);
    await request(app).post("/api/marchand/shop-orders/ZD-AAAA/accept").expect(401);
  });
});
