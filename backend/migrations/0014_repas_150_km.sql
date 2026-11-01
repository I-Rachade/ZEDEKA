-- Livraison des repas un peu moins chère que les colis : 500 FCFA minimum puis 150 FCFA/km (colis : 1 000 + 200/km).
-- Nouvelle base : la ligne des réglages est créée avec ce tarif. Base existante : seulement si l'admin n'a pas
-- déjà changé le tarif repas par défaut (500 + 200/km).
INSERT OR IGNORE INTO "Settings" ("id", "foodPerKmFee") VALUES (1, 150);
UPDATE "Settings" SET "foodPerKmFee" = 150 WHERE "id" = 1 AND "foodPerKmFee" = 200 AND "foodMinFee" = 500;
