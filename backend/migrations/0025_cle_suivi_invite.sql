-- Commande sans compte : empreinte d'une clé gardée seulement sur l'appareil qui a commandé. Elle seule permet de
-- voir le code de livraison et de confirmer la réception (le livreur connaît le code de la commande et le numéro).
ALTER TABLE "Order" ADD COLUMN "receiptKeyHash" TEXT;
