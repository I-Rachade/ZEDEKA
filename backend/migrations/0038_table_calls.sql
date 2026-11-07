-- Sonnerie de table : le client assis à une table appelle le serveur ou demande l'addition depuis le QR code,
-- l'espace restaurant sonne. Interrupteur par restaurant (activé par défaut). Uniquement des ajouts.
ALTER TABLE "Restaurant" ADD COLUMN "tableCallsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "TableCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tableNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WAITER',
    "payment" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "rungAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remindedAt" DATETIME,
    "ackAt" DATETIME,
    "ackBy" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TableCall_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TableCall_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "RestaurantTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TableCall_restaurantId_status_idx" ON "TableCall"("restaurantId", "status");
CREATE INDEX "TableCall_tableId_status_idx" ON "TableCall"("tableId", "status");
