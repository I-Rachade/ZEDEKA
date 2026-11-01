-- Demande de position aussi pour les repas : le texte du lien et la page du destinataire parlent d'un repas.
ALTER TABLE "LocationRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PARCEL';
