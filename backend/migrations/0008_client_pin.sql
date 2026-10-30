-- Connexion des clients par code PIN, avec le téléphone ou l'e-mail. Le code SMS reste pour l'inscription et le PIN oublié.
ALTER TABLE "Customer" ADD COLUMN "email" TEXT;
ALTER TABLE "Customer" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "Customer" ADD COLUMN "pinAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN "pinLockedUntil" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "pinResetUntil" DATETIME;
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");
