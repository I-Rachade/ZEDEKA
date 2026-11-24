-- Code de déblocage de l'agent : secret partagé avec le téléphone (chiffré au repos).
-- La console en dérive un code à 8 chiffres valable environ 2 h, vérifiable par le téléphone même hors ligne.
ALTER TABLE devices ADD COLUMN unlock_secret_enc TEXT;
