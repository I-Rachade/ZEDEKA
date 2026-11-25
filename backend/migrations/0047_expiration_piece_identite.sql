-- Pièce d'identité des livreurs : dates de délivrance et d'expiration, et dernier rappel d'expiration envoyé.
-- Migration additive : nouvelles colonnes seulement.
ALTER TABLE "ZedDocument" ADD COLUMN "issuedAt" DATETIME;
ALTER TABLE "ZedDocument" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "ZedDocument" ADD COLUMN "expiryNotice" TEXT;
