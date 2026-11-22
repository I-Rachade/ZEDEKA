-- Reversement des relevés par mobile money : numéro du commerce, et sur chaque relevé la façon dont il a été réglé.
-- Migration additive : cinq colonnes, aucune donnée touchée.

ALTER TABLE "Restaurant" ADD COLUMN "payoutPhone" TEXT;
ALTER TABLE "RestaurantSettlement" ADD COLUMN "payoutMethod" TEXT;
ALTER TABLE "RestaurantSettlement" ADD COLUMN "payoutPhone" TEXT;
ALTER TABLE "RestaurantSettlement" ADD COLUMN "payoutRef" TEXT;
ALTER TABLE "RestaurantSettlement" ADD COLUMN "paidBy" TEXT;
