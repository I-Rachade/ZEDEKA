-- Rôle « Managerin » (TeamMember.role = 'MANAGER', colonne texte : rien à changer), demandes des clients et
-- partenaires traitées par les managerins, et attribution automatique des courses (désactivée par défaut).
ALTER TABLE "Settings" ADD COLUMN "autoDispatchEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "autoDispatchMaxTries" INTEGER NOT NULL DEFAULT 3;

CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'IN',
    "subject" TEXT NOT NULL,
    "details" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "orderId" TEXT,
    "restaurantId" TEXT,
    "createdBy" TEXT NOT NULL,
    "assignedTo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "SupportRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SupportRequest_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SupportRequest_status_createdAt_idx" ON "SupportRequest"("status", "createdAt");
CREATE INDEX "SupportRequest_orderId_idx" ON "SupportRequest"("orderId");
CREATE INDEX "SupportRequest_restaurantId_idx" ON "SupportRequest"("restaurantId");

CREATE TABLE "SupportRequestNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportRequestNote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupportRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SupportRequestNote_requestId_createdAt_idx" ON "SupportRequestNote"("requestId", "createdAt");
