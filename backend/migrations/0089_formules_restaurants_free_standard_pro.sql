-- Formules restaurants du 28/11/2026 (demande de Rachade) : Free (0 FCFA, livraison à la course payée par le client),
-- Standard 15 000 FCFA/mois (clé interne ESSENTIEL) et Pro 25 000 FCFA/mois. Les restaurants déjà inscrits gardent
-- le prix enregistré sur leur fiche.
INSERT OR IGNORE INTO "Settings" ("id") VALUES (1);
UPDATE "Settings" SET "vendorSubscriptionFee" = 15000, "proSubscriptionFee" = 25000 WHERE "id" = 1;
