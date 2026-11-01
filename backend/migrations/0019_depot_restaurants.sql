-- Dépôt de Zedeka chez chaque restaurant : le restaurant se paie dessus les plats des commandes livrées et payées
-- à Zedeka, Zedeka recharge. Remplace les relevés pour les restaurants qui ont un dépôt.
CREATE TABLE "RestaurantDeposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RestaurantDeposit_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RestaurantDeposit_restaurantId_createdAt_idx" ON "RestaurantDeposit"("restaurantId", "createdAt");

ALTER TABLE "Order" ADD COLUMN "paidFromDeposit" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Settings" ADD COLUMN "depositAmount" INTEGER NOT NULL DEFAULT 25000;
ALTER TABLE "Settings" ADD COLUMN "depositLowThreshold" INTEGER NOT NULL DEFAULT 5000;
