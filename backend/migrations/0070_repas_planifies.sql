-- Repas planifiés (src/plannedMeals.ts) : commande à l'avance pour une heure donnée (ONCE), ou formule cantine à la
-- semaine (WEEKLY : jours et heure fixes, sur 1 à 4 semaines). La vraie commande est créée 60 min avant l'heure.
-- Migration additive : deux tables neuves, aucune donnée existante touchée.
CREATE TABLE "PlannedMeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ONCE',
    "items" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "latitude" REAL,
    "longitude" REAL,
    "note" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "deliverTime" TEXT NOT NULL,
    "days" TEXT,
    "deliverAt" DATETIME,
    "endsAt" DATETIME,
    "nextRunAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "estimate" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PlannedMeal_status_nextRunAt_idx" ON "PlannedMeal"("status", "nextRunAt");
CREATE INDEX "PlannedMeal_customerId_idx" ON "PlannedMeal"("customerId");
CREATE INDEX "PlannedMeal_restaurantId_idx" ON "PlannedMeal"("restaurantId");

CREATE TABLE "PlannedMealRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plannedMealId" TEXT NOT NULL,
    "deliverAt" DATETIME NOT NULL,
    "orderId" TEXT,
    "orderCode" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlannedMealRun_plannedMealId_fkey" FOREIGN KEY ("plannedMealId") REFERENCES "PlannedMeal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlannedMealRun_plannedMealId_deliverAt_key" ON "PlannedMealRun"("plannedMealId", "deliverAt");
