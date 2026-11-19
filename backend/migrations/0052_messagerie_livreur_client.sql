-- Messagerie écrite entre le client et le livreur d'une commande (src/chat.ts). Les messages restent archivés
-- après la livraison (lecture seule) et l'équipe les consulte dans le détail de la commande.
-- Migration additive : une table seulement.

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "driverId" TEXT,
    "body" TEXT NOT NULL,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ChatMessage_orderId_createdAt_idx" ON "ChatMessage"("orderId", "createdAt");
CREATE INDEX "ChatMessage_driverId_createdAt_idx" ON "ChatMessage"("driverId", "createdAt");
