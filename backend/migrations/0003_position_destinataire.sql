-- Position du destinataire d'un colis, demandée par un lien (voir LocationRequest dans prisma/schema.prisma),
-- et position du retrait donnée par l'expéditeur.
ALTER TABLE "Order" ADD COLUMN "pickupLatitude" REAL;
ALTER TABLE "Order" ADD COLUMN "pickupLongitude" REAL;
ALTER TABLE "Order" ADD COLUMN "locationSource" TEXT;

CREATE TABLE "LocationRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "openedAt" DATETIME,
    "consentAt" DATETIME,
    "respondedAt" DATETIME,
    "accuracyM" REAL,
    "landmark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LocationRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LocationRequest_orderId_key" ON "LocationRequest"("orderId");
CREATE UNIQUE INDEX "LocationRequest_tokenHash_key" ON "LocationRequest"("tokenHash");
CREATE INDEX "LocationRequest_status_expiresAt_idx" ON "LocationRequest"("status", "expiresAt");
