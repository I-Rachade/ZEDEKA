-- Onglet « Nouveautés » de l'appli client : courtes vidéos de produits, « j'aime » et commentaires des clients.
-- Migration additive : trois nouvelles tables. Aucune donnée existante touchée.

CREATE TABLE "Reel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "caption" TEXT,
    "videoUrl" TEXT NOT NULL,
    "posterUrl" TEXT,
    "menuItemId" TEXT,
    "productId" TEXT,
    "linkUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reel_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Reel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ReelLike" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReelLike_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReelLike_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReelComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReelComment_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReelComment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Reel_active_position_idx" ON "Reel"("active", "position");
CREATE INDEX "ReelLike_customerId_idx" ON "ReelLike"("customerId");
CREATE UNIQUE INDEX "ReelLike_reelId_customerId_key" ON "ReelLike"("reelId", "customerId");
CREATE INDEX "ReelComment_reelId_createdAt_idx" ON "ReelComment"("reelId", "createdAt");
CREATE INDEX "ReelComment_customerId_idx" ON "ReelComment"("customerId");
