-- Équipe de chaque restaurant : caissières et manageuses avec leur propre connexion à l'espace restaurant.
CREATE TABLE "RestaurantStaff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CASHIER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "sessionsValidFrom" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RestaurantStaff_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RestaurantStaff_email_key" ON "RestaurantStaff"("email");
CREATE INDEX "RestaurantStaff_restaurantId_idx" ON "RestaurantStaff"("restaurantId");

-- Encaissement au comptoir : qui a reçu l'argent et quand.
ALTER TABLE "Order" ADD COLUMN "counterPaidBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "counterPaidAt" DATETIME;
