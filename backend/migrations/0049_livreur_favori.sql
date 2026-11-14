-- Livreur favori : un restaurant ou un marchand invite jusqu'à 3 livreurs Zedeka (dans l'ordre) ; le livreur accepte
-- ou refuse. Ses courses sont proposées d'abord à ses favoris, puis partent en « demande ouverte » (répartition
-- habituelle). Le restaurant peut aussi enregistrer lui-même une livraison pour un client qui l'a contacté hors de
-- l'appli (Order.source = 'RESTAURANT'). Migration additive : une table et des colonnes seulement.

CREATE TABLE "FavoriteDriver" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT,
    "merchantId" TEXT,
    "driverId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "invitedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    CONSTRAINT "FavoriteDriver_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FavoriteDriver_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FavoriteDriver_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FavoriteDriver_restaurantId_driverId_key" ON "FavoriteDriver"("restaurantId", "driverId");
CREATE UNIQUE INDEX "FavoriteDriver_merchantId_driverId_key" ON "FavoriteDriver"("merchantId", "driverId");
CREATE INDEX "FavoriteDriver_driverId_status_idx" ON "FavoriteDriver"("driverId", "status");

ALTER TABLE "Restaurant" ADD COLUMN "favoriteFirst" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Merchant" ADD COLUMN "favoriteFirst" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Order" ADD COLUMN "dispatchRoute" TEXT;
ALTER TABLE "Order" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'APP';
