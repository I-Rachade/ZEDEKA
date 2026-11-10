-- Course Zed réservée à l'avance (jour et heure, jusqu'à 7 jours) : statut SCHEDULED en attendant l'heure.
-- Un conducteur Zed peut la réserver d'avance (driverId posé, toujours SCHEDULED) ; 15 minutes avant l'heure,
-- la tâche de chaque minute la passe à ACCEPTED s'il y a un conducteur, sinon en recherche comme un appel normal.
-- Migration additive : une colonne et un index.
ALTER TABLE "ZedRide" ADD COLUMN "scheduledFor" DATETIME;
CREATE INDEX "ZedRide_status_scheduledFor_idx" ON "ZedRide"("status", "scheduledFor");
