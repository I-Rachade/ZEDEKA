-- Repas : livraison au km entre le restaurant et la position du client, tarif défini dans les réglages.
-- Sans position du client, le prix fixe de sa zone reste appliqué.
ALTER TABLE "Settings" ADD COLUMN "foodMinFee" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Settings" ADD COLUMN "foodPerKmFee" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "Settings" ADD COLUMN "foodMaxFee" INTEGER NOT NULL DEFAULT 0;
