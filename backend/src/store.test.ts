import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { byteRange } from "./routes/menuImages.js";
import { invalidateServices, listModules } from "./services.js";
import { billingOf, canRequest, initialReview, productInput, readJson, REVIEWED_FIRST, reviewAfterEdit, saleSplit, slugify, storeInput } from "./store.js";

const product = { name: "Robe wax longue", price: 12_500, stock: 4, imageUrls: ["https://zedeka.example/api/media/menu-images/shop-m1/0e7c4a2b-1111-2222-3333-444455556666.jpg"] };

describe("boutiques en ligne : vérification des produits", () => {
  it("les premiers produits sont vérifiés, les suivants publiés directement", () => {
    expect(initialReview(0)).toBe("PENDING");
    expect(initialReview(REVIEWED_FIRST - 1)).toBe("PENDING");
    expect(initialReview(REVIEWED_FIRST)).toBe("APPROVED");
  });

  it("une modification du nom, des photos ou de la description repasse en vérification avant la confiance", () => {
    expect(reviewAfterEdit("APPROVED", 2, true)).toBe("PENDING");
    // Prix ou stock seulement : le produit reste publié.
    expect(reviewAfterEdit("APPROVED", 2, false)).toBe("APPROVED");
    // Un produit refusé et corrigé est revu.
    expect(reviewAfterEdit("REJECTED", 2, false)).toBe("PENDING");
    // Boutique de confiance : tout est publié.
    expect(reviewAfterEdit("REJECTED", REVIEWED_FIRST, true)).toBe("APPROVED");
  });

  it("demande de mise en ligne au début ou après un refus seulement", () => {
    expect(canRequest("NONE")).toBe(true);
    expect(canRequest("REJECTED")).toBe(true);
    expect(canRequest("PENDING")).toBe(false);
    expect(canRequest("ONLINE")).toBe(false);
    expect(canRequest("SUSPENDED")).toBe(false);
  });
});

describe("boutiques en ligne : facturation comme les restaurants", () => {
  it("commission en % ou abonnement mensuel", () => {
    expect(billingOf(10, null)).toEqual({ mode: "COMMISSION", rate: 10, fee: null });
    expect(billingOf(0, 15_000)).toEqual({ mode: "SUBSCRIPTION", rate: 0, fee: 15_000 });
    // Un taux sans abonnement reste une commission (même à 0 %).
    expect(billingOf(0, null).mode).toBe("COMMISSION");
    expect(billingOf(8, 15_000)).toEqual({ mode: "COMMISSION", rate: 8, fee: null });
  });

  it("part de Zedeka et part du marchand sur une vente", () => {
    expect(saleSplit(20_500, 10)).toEqual({ commission: 2_050, net: 18_450 });
    expect(saleSplit(12_345, 0)).toEqual({ commission: 0, net: 12_345 });
  });
});

describe("boutiques en ligne : saisie", () => {
  it("adresse de la page à partir du nom", () => {
    expect(slugify("Awa Couture")).toBe("awa-couture");
    expect(slugify("Beauté & Soins — Tokoin")).toBe("beaute-et-soins-tokoin");
    expect(slugify("!!!")).toBe("boutique");
  });

  it("valide un produit : photo obligatoire, prix, stock, choix", () => {
    expect(productInput.safeParse(product).success).toBe(true);
    expect(productInput.safeParse({ ...product, imageUrls: [] }).success).toBe(false);
    expect(productInput.safeParse({ ...product, price: 0 }).success).toBe(false);
    expect(productInput.safeParse({ ...product, stock: -1 }).success).toBe(false);
    expect(productInput.safeParse({ ...product, imageUrls: ["javascript:alert(1)"] }).success).toBe(false);
    const withOptions = productInput.parse({ ...product, options: [{ name: "Taille", values: ["S", "M"] }] });
    expect(withOptions.options[0].values).toEqual(["S", "M"]);
    expect(productInput.safeParse({ ...product, options: [{ name: "Taille", values: [] }] }).success).toBe(false);
  });

  it("valide la présentation : catégorie connue et pièce ou IFU", () => {
    expect(storeInput.safeParse({ storeCategory: "mode", storeIdNumber: "IFU 3201912345678" }).success).toBe(true);
    expect(storeInput.safeParse({ storeCategory: "armes", storeIdNumber: "IFU 3201912345678" }).success).toBe(false);
    expect(storeInput.safeParse({ storeCategory: "mode", storeIdNumber: "12" }).success).toBe(false);
  });

  it("lit les colonnes JSON sans casser sur une valeur abîmée", () => {
    expect(readJson<string[]>('["a"]', [])).toEqual(["a"]);
    expect(readJson<string[]>("{oups", [])).toEqual([]);
    expect(readJson<string[]>('{"a":1}', [])).toEqual([]);
  });
});

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

  it("l'appli marchand demande la connexion", async () => {
    const app = createApp({} as PrismaClient, { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) });
    await request(app).get("/api/marchand/store").expect(401);
    await request(app).post("/api/marchand/products").send(product).expect(401);
  });
});
