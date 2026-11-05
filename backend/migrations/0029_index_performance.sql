-- Index manquants relevés au test de charge : sans eux, D1 relit toute la table à chaque recherche
-- (ex. les lignes d'une commande, à chaque rafraîchissement de la caisse et du suivi). Migration additive.
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "MenuVariant_menuItemId_idx" ON "MenuVariant"("menuItemId");
CREATE INDEX IF NOT EXISTS "Addon_restaurantId_idx" ON "Addon"("restaurantId");
CREATE INDEX IF NOT EXISTS "Order_driverId_status_idx" ON "Order"("driverId", "status");
CREATE INDEX IF NOT EXISTS "Order_settlementId_idx" ON "Order"("settlementId");
CREATE INDEX IF NOT EXISTS "Order_cashCollectionId_idx" ON "Order"("cashCollectionId");
CREATE INDEX IF NOT EXISTS "DriverLocation_orderId_idx" ON "DriverLocation"("orderId");
