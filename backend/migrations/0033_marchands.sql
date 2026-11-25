-- Appli marchands e-commerce : une boutique ajoute un profil marchand à son compte client et envoie ses colis
-- (un ou plusieurs à la fois), avec contre-remboursement encaissé par le livreur et reversé par Zedeka.
-- Migration additive : nouvelles tables et colonnes seulement.

CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupLatitude" REAL,
    "pickupLongitude" REAL,
    "pickupDays" TEXT NOT NULL DEFAULT '',
    "pickupTime" TEXT,
    "payoutPhone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pickupRequestedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Merchant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Merchant_customerId_key" ON "Merchant"("customerId");

CREATE TABLE "MerchantPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "paidBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MerchantPayout_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MerchantPayout_merchantId_createdAt_idx" ON "MerchantPayout"("merchantId", "createdAt");

ALTER TABLE "Order" ADD COLUMN "merchantId" TEXT REFERENCES "Merchant" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "codAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "merchantRef" TEXT;
ALTER TABLE "Order" ADD COLUMN "merchantPayoutId" TEXT REFERENCES "MerchantPayout" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Order_merchantId_createdAt_idx" ON "Order"("merchantId", "createdAt");
CREATE INDEX "Order_merchantPayoutId_idx" ON "Order"("merchantPayoutId");
