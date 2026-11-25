-- Personne de l'espace restaurant qui a accepté la commande (nom et rôle : OWNER, MANAGER, CASHIER), pour la chronologie.
ALTER TABLE "Order" ADD COLUMN "confirmedBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "confirmedByRole" TEXT;
