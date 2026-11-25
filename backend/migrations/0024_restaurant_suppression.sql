-- Suppression d'un restaurant depuis l'admin. Sans historique, la ligne est effacée ; avec des commandes passées,
-- relevés ou dépôts, le restaurant est fermé et masqué, ses accès effacés, mais la ligne reste pour que les
-- anciennes commandes, les finances et les rapports gardent son nom.
ALTER TABLE "Restaurant" ADD COLUMN "deletedAt" DATETIME;
