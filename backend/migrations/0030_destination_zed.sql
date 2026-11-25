-- Destination facultative d'une course Zed, écrite par le client (« Grand marché »), montrée au conducteur
-- dans l'appel et pendant la course. Texte libre, sans position. Migration additive.
ALTER TABLE "ZedRide" ADD COLUMN "destination" TEXT;
