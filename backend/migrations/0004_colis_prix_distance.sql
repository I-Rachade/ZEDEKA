-- Colis : le prix vient de la distance, avec un tarif défini dans les réglages. La zone reste obligatoire mais se
-- déduit de la position : chaque zone a un centre, et la zone retenue est celle dont le centre est le plus proche.
-- Un colis qui attend la position du destinataire est rangé dans une zone technique cachée, « Zone à déterminer ».
ALTER TABLE "Settings" ADD COLUMN "parcelMinFee" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "Settings" ADD COLUMN "parcelPerKmFee" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "Settings" ADD COLUMN "parcelMaxFee" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Zone" ADD COLUMN "latitude" REAL;
ALTER TABLE "Zone" ADD COLUMN "longitude" REAL;

INSERT OR IGNORE INTO "Zone" ("id", "name", "pricing", "deliveryFee", "active") VALUES ('parcels', 'Zone à déterminer', 'DISTANCE', 0, false);

-- Demande de position créée avant la commande : l'expéditeur copie le lien, attend la réponse, puis valide.
-- orderId devient facultatif ; la position reçue est gardée sur la demande jusqu'à la commande.
CREATE TABLE "LocationRequest_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "pollKeyHash" TEXT,
    "senderName" TEXT,
    "recipientName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "openedAt" DATETIME,
    "consentAt" DATETIME,
    "respondedAt" DATETIME,
    "latitude" REAL,
    "longitude" REAL,
    "accuracyM" REAL,
    "landmark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LocationRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "LocationRequest_new" ("id", "orderId", "tokenHash", "status", "expiresAt", "openedAt", "consentAt", "respondedAt", "accuracyM", "landmark", "createdAt")
    SELECT "id", "orderId", "tokenHash", "status", "expiresAt", "openedAt", "consentAt", "respondedAt", "accuracyM", "landmark", "createdAt" FROM "LocationRequest";
DROP TABLE "LocationRequest";
ALTER TABLE "LocationRequest_new" RENAME TO "LocationRequest";
CREATE UNIQUE INDEX "LocationRequest_orderId_key" ON "LocationRequest"("orderId");
CREATE UNIQUE INDEX "LocationRequest_tokenHash_key" ON "LocationRequest"("tokenHash");
CREATE UNIQUE INDEX "LocationRequest_pollKeyHash_key" ON "LocationRequest"("pollKeyHash");
CREATE INDEX "LocationRequest_status_expiresAt_idx" ON "LocationRequest"("status", "expiresAt");
