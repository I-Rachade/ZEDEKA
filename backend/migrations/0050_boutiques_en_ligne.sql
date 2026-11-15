-- Boutiques en ligne (étape 1) : catalogue de produits des marchands et validation par l'équipe.
-- Migration additive : nouvelles colonnes sur Merchant et nouvelle table Product. Aucune donnée existante touchée.
-- Le module « Boutiques » (SHOP) reste coupé tant que le directeur ne l'ouvre pas dans la page Services.

-- Vente en ligne de la boutique : NONE (pas demandée), PENDING (à valider), ONLINE, REJECTED, SUSPENDED.
ALTER TABLE "Merchant" ADD COLUMN "storeStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Merchant" ADD COLUMN "storeSlug" TEXT;
ALTER TABLE "Merchant" ADD COLUMN "storeCategory" TEXT;
ALTER TABLE "Merchant" ADD COLUMN "storeDescription" TEXT;
ALTER TABLE "Merchant" ADD COLUMN "storeLogoUrl" TEXT;
ALTER TABLE "Merchant" ADD COLUMN "storeIdNumber" TEXT;
-- Facturation, comme les restaurants : commission en % par vente, ou 0 % et un abonnement mensuel.
ALTER TABLE "Merchant" ADD COLUMN "storeCommissionRate" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Merchant" ADD COLUMN "storeSubscriptionFee" INTEGER;
ALTER TABLE "Merchant" ADD COLUMN "storeRequestedAt" DATETIME;
ALTER TABLE "Merchant" ADD COLUMN "storeReviewedAt" DATETIME;
ALTER TABLE "Merchant" ADD COLUMN "storeReviewedBy" TEXT;
ALTER TABLE "Merchant" ADD COLUMN "storeNote" TEXT;
CREATE UNIQUE INDEX "Merchant_storeSlug_key" ON "Merchant"("storeSlug");
CREATE INDEX "Merchant_storeStatus_idx" ON "Merchant"("storeStatus");

-- Produit d'une boutique. review : PENDING (à vérifier par l'équipe), APPROVED, REJECTED.
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "section" TEXT NOT NULL DEFAULT '',
    "options" TEXT NOT NULL DEFAULT '[]',
    "imageUrls" TEXT NOT NULL DEFAULT '[]',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "review" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Product_merchantId_archivedAt_idx" ON "Product"("merchantId", "archivedAt");
CREATE INDEX "Product_review_idx" ON "Product"("review");

-- Bannières de la page d'une boutique : images et vidéos publicitaires en carrousel, gérées par le marchand.
CREATE TABLE "StoreBanner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'IMAGE',
    "url" TEXT NOT NULL,
    "posterUrl" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "productId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoreBanner_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoreBanner_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "StoreBanner_merchantId_position_idx" ON "StoreBanner"("merchantId", "position");
