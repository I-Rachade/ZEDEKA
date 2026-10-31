-- Connexion des livreurs par numéro et code PIN, comme les clients. Le code SMS reste pour le PIN oublié.
ALTER TABLE "Driver" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "Driver" ADD COLUMN "pinAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Driver" ADD COLUMN "pinLockedUntil" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "pinResetUntil" DATETIME;
