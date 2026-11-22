-- Offres commerciales (src/offers.ts) : palier Pro des restaurants, tarif boutique des marchands et parrainage.
-- Migration additive : nouvelles colonnes et index seulement, aucune donnée touchée.

-- Palier d'abonnement d'un commerce : ESSENTIEL (par défaut) ou PRO.
ALTER TABLE "Restaurant" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'ESSENTIEL';

-- Réglages : prix du palier Pro, seuil conseillé, tarif boutique et seuil du tarif boutique.
ALTER TABLE "Settings" ADD COLUMN "proSubscriptionFee" INTEGER NOT NULL DEFAULT 35000;
ALTER TABLE "Settings" ADD COLUMN "essentialOrderLimit" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "Settings" ADD COLUMN "merchantFlatFee" INTEGER NOT NULL DEFAULT 800;
ALTER TABLE "Settings" ADD COLUMN "merchantFlatFrom" INTEGER NOT NULL DEFAULT 20;

-- Colis de marchand envoyé au tarif boutique (le prix fixe reste acquis quand le point de livraison arrive).
ALTER TABLE "Order" ADD COLUMN "flatRate" BOOLEAN NOT NULL DEFAULT false;

-- Parrainage : code du client, parrain et date, livraison offerte utilisée sur une commande.
ALTER TABLE "Customer" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "referredById" TEXT;
ALTER TABLE "Customer" ADD COLUMN "referredAt" DATETIME;
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");
CREATE INDEX "Customer_referredById_idx" ON "Customer"("referredById");
ALTER TABLE "Order" ADD COLUMN "referralCredit" BOOLEAN NOT NULL DEFAULT false;
