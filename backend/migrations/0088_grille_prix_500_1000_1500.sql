-- Grille de prix du 27/11/2026 (demande de Rachade, reprise du prospectus 14,5 x 20 cm) :
-- 500 FCFA jusqu'à 5 km, 1 000 FCFA jusqu'à 10 km, 1 500 FCFA au-delà, jamais plus.
-- Même grille pour les repas, les colis et la course demandée (Course Zed). Le plafond colis de 3 000 FCFA disparaît.
-- Les tarifs au km restent dans les réglages, utilisables en repassant le mode sur « Au km ».
ALTER TABLE "Settings" ADD COLUMN "zedPricingMode" TEXT NOT NULL DEFAULT 'GRID';
ALTER TABLE "Settings" ADD COLUMN "gridTier1Km" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Settings" ADD COLUMN "gridTier1Fee" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Settings" ADD COLUMN "gridTier2Km" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Settings" ADD COLUMN "gridTier2Fee" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "Settings" ADD COLUMN "gridTier3Fee" INTEGER NOT NULL DEFAULT 1500;
INSERT OR IGNORE INTO "Settings" ("id") VALUES (1);
UPDATE "Settings" SET "foodPricingMode" = 'GRID', "parcelPricingMode" = 'GRID', "zedPricingMode" = 'GRID' WHERE "id" = 1;
