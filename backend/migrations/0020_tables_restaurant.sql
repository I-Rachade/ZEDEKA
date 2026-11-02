-- Tables numérotées des restaurants : chaque QR code ouvre la carte de la table, la commande sur place garde le numéro.
CREATE TABLE "RestaurantTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RestaurantTable_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RestaurantTable_token_key" ON "RestaurantTable"("token");
CREATE UNIQUE INDEX "RestaurantTable_restaurantId_number_key" ON "RestaurantTable"("restaurantId", "number");

ALTER TABLE "Order" ADD COLUMN "tableNumber" INTEGER;
