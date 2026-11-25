-- Restaurant avec un dépôt Zedeka et livreur indépendant : le livreur paie les plats au restaurant sur place
-- (prix des plats moins la commission), le dépôt n'est pas débité et la commande ne va pas sur le relevé.
-- Zedeka retient cette avance sur les espèces que le livreur remet (ou la lui doit pour un paiement mobile money).
ALTER TABLE "Order" ADD COLUMN "paidByDriver" BOOLEAN NOT NULL DEFAULT false;
