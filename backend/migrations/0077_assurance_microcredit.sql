-- Assurance et micro-crédit des livreurs (src/riderFinance.ts) : demandes, sinistres et remboursements.
-- Migration additive : deux tables, aucune donnée touchée.

CREATE TABLE "RiderFinance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "amount" INTEGER,
    "months" INTEGER,
    "note" TEXT,
    "incidentAt" DATETIME,
    "parentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "partner" TEXT,
    "partnerRef" TEXT,
    "approvedAmount" INTEGER,
    "totalDue" INTEGER,
    "installment" INTEGER,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "staffNote" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "decidedAt" DATETIME,
    "activatedAt" DATETIME,
    "closedAt" DATETIME,
    CONSTRAINT "RiderFinance_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RiderFinance_driverId_kind_idx" ON "RiderFinance"("driverId", "kind");
CREATE INDEX "RiderFinance_status_idx" ON "RiderFinance"("status");
CREATE INDEX "RiderFinance_parentId_idx" ON "RiderFinance"("parentId");

CREATE TABLE "RiderFinancePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "recordedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiderFinancePayment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RiderFinance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RiderFinancePayment_requestId_idx" ON "RiderFinancePayment"("requestId");
