-- Preuve du consentement (loi n° 2017-07 sur les transactions électroniques, loi n° 2019-014 sur les données) :
-- heure à laquelle les conditions générales et la politique de confidentialité ont été acceptées, avec la
-- déclaration d'âge (18 ans ou plus). Colonnes facultatives : les lignes existantes restent sans date.
ALTER TABLE "Order" ADD COLUMN "termsAcceptedAt" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "termsAcceptedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "termsAcceptedAt" DATETIME;
