-- Leasing de motos aux livreurs et conducteurs indépendants (src/lease.ts, src/routes/adminLease.ts) : un contrat par
-- moto louée (prix par jour figé à la signature), et les paiements du livreur (mobile money confirmé par l'équipe,
-- ou espèces au bureau). Prix par défaut et blocage en cas de retard dans les réglages.
-- Migration additive : deux tables et trois colonnes de réglages, aucune donnée touchée.

CREATE TABLE "LeaseContract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "label" TEXT,
    "dailyRate" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deposit" INTEGER,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "endReason" TEXT,
    "remindedOn" TEXT,
    "staffAlertedAt" DATETIME,
    CONSTRAINT "LeaseContract_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LeaseContract_driverId_status_idx" ON "LeaseContract"("driverId", "status");
CREATE INDEX "LeaseContract_status_idx" ON "LeaseContract"("status");

CREATE TABLE "LeasePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" DATETIME,
    "reviewedBy" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeasePayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "LeaseContract" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeasePayment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LeasePayment_reference_key" ON "LeasePayment"("reference");
CREATE INDEX "LeasePayment_contractId_status_idx" ON "LeasePayment"("contractId", "status");
CREATE INDEX "LeasePayment_status_createdAt_idx" ON "LeasePayment"("status", "createdAt");

ALTER TABLE "Settings" ADD COLUMN "leaseHomeRate" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "Settings" ADD COLUMN "leaseZedekaRate" INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE "Settings" ADD COLUMN "leaseBlockDays" INTEGER NOT NULL DEFAULT 0;
