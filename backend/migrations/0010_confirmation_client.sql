-- Clôture de la livraison par le client (bouton, code à 4 chiffres ou clôture automatique) et notes
-- du livreur et du restaurant. Colonnes ajoutées seulement.
ALTER TABLE "Order" ADD COLUMN "handedOverAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "deliveryCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "closedBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "receiptDisputedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "receiptDisputeNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "driverRating" INTEGER;
ALTER TABLE "Order" ADD COLUMN "restaurantRating" INTEGER;
ALTER TABLE "Order" ADD COLUMN "ratingComment" TEXT;
ALTER TABLE "Order" ADD COLUMN "ratedAt" DATETIME;
