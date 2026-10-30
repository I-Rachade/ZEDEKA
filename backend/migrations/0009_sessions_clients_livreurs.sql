-- Déconnexion côté serveur des clients et des livreurs : les jetons émis avant cette date sont refusés
-- (« se déconnecter de tous les appareils », téléphone perdu, livreur suspendu ou numéro changé).
ALTER TABLE "Customer" ADD COLUMN "sessionsValidFrom" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "sessionsValidFrom" DATETIME;
