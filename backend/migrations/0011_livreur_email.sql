-- Connexion des livreurs avec l'e-mail et le code PIN, comme les clients (e-mail facultatif).
ALTER TABLE "Driver" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "Driver_email_key" ON "Driver"("email");
