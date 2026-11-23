-- Zedeka+ (abonnement client), fidélité (points des clients, défis des livreurs) et mises en avant payées des
-- commerces (src/loyalty.ts). Migration additive : nouvelles tables et colonnes seulement, aucune donnée touchée.

-- Réglages : prix et avantage de Zedeka+, barème des points, prix d'une semaine de mise en avant.
ALTER TABLE "Settings" ADD COLUMN "plusEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Settings" ADD COLUMN "plusMonthlyFee" INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE "Settings" ADD COLUMN "plusDeliveryDiscount" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Settings" ADD COLUMN "plusMinSubtotal" INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE "Settings" ADD COLUMN "loyaltySpendPerPoint" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Settings" ADD COLUMN "loyaltyRewardPoints" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "Settings" ADD COLUMN "sponsorWeekFee" INTEGER NOT NULL DEFAULT 5000;

-- Zedeka+ : fin de l'abonnement du client, et demande d'abonnement en attente de paiement.
ALTER TABLE "Customer" ADD COLUMN "plusUntil" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "plusRequestedAt" DATETIME;
CREATE INDEX "Customer_plusUntil_idx" ON "Customer"("plusUntil");
CREATE INDEX "Customer_plusRequestedAt_idx" ON "Customer"("plusRequestedAt");

-- Commande : remise Zedeka+ appliquée, points de fidélité dépensés pour une livraison offerte.
ALTER TABLE "Order" ADD COLUMN "plusApplied" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "loyaltyRedeemed" INTEGER NOT NULL DEFAULT 0;

-- Paiements de Zedeka+ encaissés par l'équipe (mobile money ou espèces, confirmés à la main).
CREATE TABLE "PlusPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlusPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PlusPayment_customerId_idx" ON "PlusPayment"("customerId");
CREATE INDEX "PlusPayment_createdAt_idx" ON "PlusPayment"("createdAt");

-- Défis des livreurs : un nombre de livraisons à faire sur une période, une prime versée par l'équipe.
CREATE TABLE "DriverChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DriverChallenge_endsAt_idx" ON "DriverChallenge"("endsAt");
CREATE TABLE "DriverChallengeReward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "challengeId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidBy" TEXT,
    CONSTRAINT "DriverChallengeReward_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "DriverChallenge" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DriverChallengeReward_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DriverChallengeReward_challengeId_driverId_key" ON "DriverChallengeReward"("challengeId", "driverId");

-- Mise en avant payée d'un restaurant ou d'une boutique : en tête des listes, badge « Sponsorisé », jusqu'à cette date.
ALTER TABLE "Restaurant" ADD COLUMN "sponsoredUntil" DATETIME;
CREATE TABLE "SponsorPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "weeks" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SponsorPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SponsorPayment_restaurantId_idx" ON "SponsorPayment"("restaurantId");
CREATE INDEX "SponsorPayment_createdAt_idx" ON "SponsorPayment"("createdAt");
