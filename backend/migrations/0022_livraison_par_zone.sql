-- Livraison facturée au km ou par zone, au choix dans les réglages, séparément pour les repas et pour les colis.
-- KM (par défaut, comme aujourd'hui) : tarif au km des réglages. ZONE : prix fixe de la zone de livraison (écran Zones).
-- Colonnes ajoutées seulement ; les prix des zones (deliveryFee) existent déjà.
ALTER TABLE "Settings" ADD COLUMN "foodPricingMode" TEXT NOT NULL DEFAULT 'KM';
ALTER TABLE "Settings" ADD COLUMN "parcelPricingMode" TEXT NOT NULL DEFAULT 'KM';
