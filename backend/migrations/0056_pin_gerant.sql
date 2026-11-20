-- Connexion du gérant d'un commerce par numéro et code PIN. Migration additive : trois colonnes, aucune donnée touchée.

ALTER TABLE "Restaurant" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "pinAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Restaurant" ADD COLUMN "pinLockedUntil" DATETIME;
