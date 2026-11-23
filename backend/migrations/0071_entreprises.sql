-- Commandes d'entreprise (src/companies.ts) : comptes entreprise (bureaux, écoles) avec leurs membres, commandes
-- facturées à l'entreprise (rien à encaisser par le livreur), facture mensuelle, et commandes groupées (un lien
-- partagé où chacun ajoute ses plats, une seule commande livrée). Migration additive : tables neuves et deux colonnes.
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OFFICE',
    "contactName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "address" TEXT NOT NULL DEFAULT '',
    "taxId" TEXT,
    "monthlyLimit" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CompanyMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CompanyMember_companyId_phone_key" ON "CompanyMember"("companyId", "phone");
CREATE INDEX "CompanyMember_phone_idx" ON "CompanyMember"("phone");

CREATE TABLE "CompanyInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "paidAt" DATETIME,
    "paidNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CompanyInvoice_companyId_month_key" ON "CompanyInvoice"("companyId", "month");

ALTER TABLE "Order" ADD COLUMN "companyId" TEXT;
CREATE INDEX "Order_companyId_deliveredAt_idx" ON "Order"("companyId", "deliveredAt");

CREATE TABLE "GroupOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "hostCustomerId" TEXT NOT NULL,
    "hostName" TEXT NOT NULL,
    "hostPhone" TEXT NOT NULL,
    "companyId" TEXT,
    "address" TEXT NOT NULL DEFAULT '',
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "deadline" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "orderId" TEXT,
    "orderCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GroupOrder_code_key" ON "GroupOrder"("code");
CREATE INDEX "GroupOrder_hostCustomerId_idx" ON "GroupOrder"("hostCustomerId");

CREATE TABLE "GroupOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupOrderId" TEXT NOT NULL,
    "participant" TEXT NOT NULL,
    "editKeyHash" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupOrderLine_groupOrderId_fkey" FOREIGN KEY ("groupOrderId") REFERENCES "GroupOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GroupOrderLine_groupOrderId_idx" ON "GroupOrderLine"("groupOrderId");
