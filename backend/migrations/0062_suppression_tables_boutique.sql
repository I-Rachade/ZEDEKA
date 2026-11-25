-- Fusion restaurants et boutiques, étape 6 : supprime les tables de l'ancienne boutique du marchand
-- (vides en production au 23/11/2026, suppression accordée par le directeur) et la colonne
-- Reel.productId (toujours NULL). SQLite ne retire pas une colonne avec clé étrangère : la table Reel
-- est reconstruite. Sa suppression efface en cascade les likes et commentaires : on les met de côté
-- puis on les remet.
PRAGMA defer_foreign_keys = true;

CREATE TABLE "ReelLike_bak" AS SELECT * FROM "ReelLike";
CREATE TABLE "ReelComment_bak" AS SELECT * FROM "ReelComment";

CREATE TABLE "Reel_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "caption" TEXT,
    "videoUrl" TEXT NOT NULL,
    "posterUrl" TEXT,
    "menuItemId" TEXT,
    "linkUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reel_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "Reel_new" SELECT "id","title","caption","videoUrl","posterUrl","menuItemId","linkUrl","position","active","startsAt","endsAt","likeCount","commentCount","createdAt","updatedAt" FROM "Reel";
DROP TABLE "Reel";
ALTER TABLE "Reel_new" RENAME TO "Reel";
CREATE INDEX "Reel_active_position_idx" ON "Reel"("active", "position");

INSERT INTO "ReelLike" SELECT * FROM "ReelLike_bak" WHERE "id" NOT IN (SELECT "id" FROM "ReelLike");
INSERT INTO "ReelComment" SELECT * FROM "ReelComment_bak" WHERE "id" NOT IN (SELECT "id" FROM "ReelComment");
DROP TABLE "ReelLike_bak";
DROP TABLE "ReelComment_bak";

DROP TABLE IF EXISTS "StoreOrderItem";
DROP TABLE IF EXISTS "StoreBanner";
DROP TABLE IF EXISTS "Product";
