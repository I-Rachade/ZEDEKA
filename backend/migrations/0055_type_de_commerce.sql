-- Type de commerce : un restaurant ou une boutique, sa catégorie, la vérification des nouveaux articles en option,
-- et des bannières en haut de sa page. Migration additive : trois colonnes et une table. Aucune donnée touchée.

ALTER TABLE "Restaurant" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'RESTAURANT';
ALTER TABLE "Restaurant" ADD COLUMN "shopCategory" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "reviewNewItems" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "RestaurantBanner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'IMAGE',
    "url" TEXT NOT NULL,
    "posterUrl" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "menuItemId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RestaurantBanner_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RestaurantBanner_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "RestaurantBanner_restaurantId_position_idx" ON "RestaurantBanner"("restaurantId", "position");
