-- Codes promo : table Promo et, sur chaque commande, le code utilisé et qui paie la remise (déjà comptée dans
-- "discount"). Migration additive : aucune colonne existante ne change.
CREATE TABLE "Promo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "maxDiscount" INTEGER,
    "minSubtotal" INTEGER NOT NULL DEFAULT 0,
    "restaurantId" TEXT,
    "payer" TEXT NOT NULL DEFAULT 'ZEDEKA',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "maxUses" INTEGER,
    "perCustomer" INTEGER NOT NULL DEFAULT 1,
    "showOnHome" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Promo_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Promo_code_key" ON "Promo"("code");
CREATE INDEX "Promo_active_idx" ON "Promo"("active");
ALTER TABLE "Order" ADD COLUMN "promoId" TEXT REFERENCES "Promo" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "promoCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "promoPayer" TEXT;
CREATE INDEX "Order_promoId_idx" ON "Order"("promoId");
