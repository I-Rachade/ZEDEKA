-- Mot de passe oublié de l'équipe admin : les sessions ouvertes avant un changement de mot de passe sont fermées.
-- Migration additive : une colonne, aucune donnée touchée.

ALTER TABLE "TeamMember" ADD COLUMN "sessionsValidFrom" DATETIME;
