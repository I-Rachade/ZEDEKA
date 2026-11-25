-- Clé anti-doublon tirée par le téléphone pour une commande ou un colis envoyé au retour du réseau : un second envoi
-- avec la même clé renvoie la commande déjà créée au lieu d'en créer une autre.
ALTER TABLE "Order" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "Order_clientKey_key" ON "Order"("clientKey");
