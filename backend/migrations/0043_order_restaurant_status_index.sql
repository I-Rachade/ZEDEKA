-- Commandes en cours d'un restaurant (pouls de l'espace restaurant toutes les 5 s, tableau « En direct ») :
-- lues par l'index au lieu de parcourir tout l'historique du restaurant. Uniquement un ajout.
CREATE INDEX IF NOT EXISTS "Order_restaurantId_status_idx" ON "Order"("restaurantId", "status");
