-- Commandes, colis et courses Zed saisis au back-office par l'équipe (demande reçue par téléphone, WhatsApp…) :
-- canal d'origine et membre de l'équipe qui l'a saisie. Ajout seul, rien n'est modifié.
ALTER TABLE "Order" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "ZedRide" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'APP';
ALTER TABLE "ZedRide" ADD COLUMN "createdBy" TEXT;
