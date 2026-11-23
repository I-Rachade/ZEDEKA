-- Livreur passé hors ligne automatiquement (application silencieuse) : remis en ligne tout seul quand
-- l'application se réveille, s'il ne s'est pas mis hors ligne lui-même entre-temps (additive).
ALTER TABLE "Driver" ADD COLUMN "autoOfflineAt" DATETIME;
