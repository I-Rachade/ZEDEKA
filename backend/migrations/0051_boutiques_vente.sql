-- Boutiques en ligne (étape 2) : vente aux clients. Migration additive : une colonne sur Order et une nouvelle
-- table d'articles. Aucune donnée existante touchée.

-- Commande d'une boutique : colis du marchand vers le client, envoyé au livreur quand le marchand l'a préparé.
ALTER TABLE "Order" ADD COLUMN "storeSale" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "StoreOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "choice" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "StoreOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoreOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "StoreOrderItem_orderId_idx" ON "StoreOrderItem"("orderId");
