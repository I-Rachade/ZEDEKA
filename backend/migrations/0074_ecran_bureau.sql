-- Écran du bureau (Raspberry Pi + moniteur) : liens en lecture seule et objectif de livraisons du jour.
-- Migration additive : une table et une colonne, aucune donnée touchée.

CREATE TABLE "DisplayScreen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME
);
CREATE UNIQUE INDEX "DisplayScreen_keyHash_key" ON "DisplayScreen"("keyHash");

ALTER TABLE "Settings" ADD COLUMN "screenDailyGoal" INTEGER NOT NULL DEFAULT 0;
