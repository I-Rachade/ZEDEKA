-- Réservation de créneau : un colis à retrait programmé est proposé aux livreurs 2 h avant l'heure (réglable) ;
-- celui qui accepte reste libre, reçoit un rappel 45 min avant, confirme, et la course devient la sienne 30 min
-- avant. Migration additive : colonnes seulement.
ALTER TABLE "Order" ADD COLUMN "slotReminderAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "slotConfirmedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "slotStartedAt" DATETIME;
ALTER TABLE "Settings" ADD COLUMN "slotOfferLeadMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "Settings" ADD COLUMN "slotOfferSeconds" INTEGER NOT NULL DEFAULT 180;
