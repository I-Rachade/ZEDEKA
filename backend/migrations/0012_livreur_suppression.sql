-- Suppression d'un livreur depuis l'admin. Sans historique, la ligne est effacée ; avec des courses passées,
-- le compte est fermé et ses coordonnées effacées, mais la ligne reste pour que les anciennes commandes,
-- remises d'espèces et rapports gardent le nom du livreur.
ALTER TABLE "Driver" ADD COLUMN "deletedAt" DATETIME;
