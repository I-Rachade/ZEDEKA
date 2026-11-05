-- Dernier message rapide du restaurant au livreur (« Prête dans 5 minutes »), affiché sur l'accueil du livreur.
ALTER TABLE "Order" ADD COLUMN "restaurantMessage" TEXT;
ALTER TABLE "Order" ADD COLUMN "restaurantMessageAt" DATETIME;
