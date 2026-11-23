-- Logistique et gestion de stock pour les e-commerçants (src/logistics.ts, src/pos.ts) : articles avec stock en
-- boutique et à l'entrepôt Zedeka, mouvements, dépôts annoncés, colis expédiés depuis l'entrepôt, retours de colis,
-- frais logistiques (stockage du mois, retours) retenus sur les reversements, et ventes de la caisse (POS).
-- Migration additive : six tables et six colonnes, aucune donnée touchée.

CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "shopQuantity" INTEGER NOT NULL DEFAULT 0,
    "price" INTEGER,
    "alertAt" INTEGER,
    "location" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockItem_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StockItem_merchantId_archivedAt_idx" ON "StockItem"("merchantId", "archivedAt");

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockItemId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "place" TEXT NOT NULL DEFAULT 'WAREHOUSE',
    "quantity" INTEGER NOT NULL,
    "orderId" TEXT,
    "depositId" TEXT,
    "saleId" TEXT,
    "note" TEXT,
    "by" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StockMovement_stockItemId_createdAt_idx" ON "StockMovement"("stockItemId", "createdAt");
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");

CREATE TABLE "StockDeposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lines" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" DATETIME,
    "receivedBy" TEXT,
    CONSTRAINT "StockDeposit_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StockDeposit_status_createdAt_idx" ON "StockDeposit"("status", "createdAt");
CREATE INDEX "StockDeposit_merchantId_createdAt_idx" ON "StockDeposit"("merchantId", "createdAt");

CREATE TABLE "ParcelReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TO_COLLECT',
    "fee" INTEGER NOT NULL DEFAULT 0,
    "requestedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atWarehouseAt" DATETIME,
    "closedAt" DATETIME,
    "closedBy" TEXT,
    CONSTRAINT "ParcelReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParcelReturn_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ParcelReturn_orderId_key" ON "ParcelReturn"("orderId");
CREATE INDEX "ParcelReturn_merchantId_status_idx" ON "ParcelReturn"("merchantId", "status");
CREATE INDEX "ParcelReturn_status_createdAt_idx" ON "ParcelReturn"("status", "createdAt");

CREATE TABLE "LogisticsCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "period" TEXT,
    "returnId" TEXT,
    "payoutId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogisticsCharge_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LogisticsCharge_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "MerchantPayout" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LogisticsCharge_returnId_key" ON "LogisticsCharge"("returnId");
CREATE UNIQUE INDEX "LogisticsCharge_merchantId_kind_period_key" ON "LogisticsCharge"("merchantId", "kind", "period");
CREATE INDEX "LogisticsCharge_merchantId_payoutId_idx" ON "LogisticsCharge"("merchantId", "payoutId");

CREATE TABLE "PosSale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "lines" TEXT NOT NULL DEFAULT '[]',
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "received" INTEGER,
    "reference" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "cashier" TEXT,
    "clientKey" TEXT,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosSale_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PosSale_clientKey_key" ON "PosSale"("clientKey");
CREATE UNIQUE INDEX "PosSale_merchantId_number_key" ON "PosSale"("merchantId", "number");
CREATE INDEX "PosSale_merchantId_createdAt_idx" ON "PosSale"("merchantId", "createdAt");

ALTER TABLE "Order" ADD COLUMN "stockLines" TEXT;
ALTER TABLE "Settings" ADD COLUMN "warehouseAddress" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "warehouseLatitude" REAL;
ALTER TABLE "Settings" ADD COLUMN "warehouseLongitude" REAL;
ALTER TABLE "Settings" ADD COLUMN "storageFeePerItem" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "Settings" ADD COLUMN "returnFee" INTEGER NOT NULL DEFAULT 500;
