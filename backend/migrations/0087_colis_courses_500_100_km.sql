-- Tarif du 27/11/2026 (demande de Rachade) : livraison des colis et course demandée (Course Zed)
-- dès 500 FCFA, 100 FCFA par km. Même calcul qu'avant : prix au km arrondi aux 50 FCFA supérieurs,
-- jamais sous le minimum. Le plafond des colis (parcelMaxFee) ne change pas. Les repas ne changent pas.
INSERT OR IGNORE INTO "Settings" ("id") VALUES (1);
UPDATE "Settings" SET "parcelMinFee" = 500, "parcelPerKmFee" = 100, "zedMinFee" = 500, "zedPerKmFee" = 100 WHERE "id" = 1;
