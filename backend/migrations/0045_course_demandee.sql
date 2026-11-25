-- « Demander une course » : quand aucun Zed n'est proche (ou pour une course programmée), un Zed plus loin
-- (rayon élargi) vient chercher le client ; la destination est obligatoire et le prix de l'itinéraire
-- (minimum + prix au km) est annoncé avant son arrivée. Migration additive : colonnes seulement.
ALTER TABLE "Settings" ADD COLUMN "zedFarRadiusM" INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE "Settings" ADD COLUMN "zedMinFee" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "Settings" ADD COLUMN "zedPerKmFee" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "ZedRide" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'CALL';
ALTER TABLE "ZedRide" ADD COLUMN "destinationLatitude" REAL;
ALTER TABLE "ZedRide" ADD COLUMN "destinationLongitude" REAL;
ALTER TABLE "ZedRide" ADD COLUMN "distanceM" INTEGER;
ALTER TABLE "ZedRide" ADD COLUMN "quotedPrice" INTEGER;
