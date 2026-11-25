-- Demandes de service (courses, gaz et eau, lessive, ménage, dépannage), services faits par chaque livreur ou
-- prestataire, et tarifs choisis dans l'admin. Uniquement des ajouts : aucune donnée existante n'est touchée.
ALTER TABLE "ServiceModule" ADD COLUMN "basePrice" INTEGER;
ALTER TABLE "ServiceModule" ADD COLUMN "unitPrice" INTEGER;
ALTER TABLE "Driver" ADD COLUMN "serviceCodes" TEXT NOT NULL DEFAULT '';

CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "customerId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "details" TEXT NOT NULL DEFAULT '{}',
    "summary" TEXT NOT NULL,
    "note" TEXT,
    "scheduledFor" DATETIME,
    "estimate" INTEGER NOT NULL,
    "extra" INTEGER,
    "finalPrice" INTEGER,
    "providerId" TEXT,
    "acceptedAt" DATETIME,
    "onTheWayAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "rating" INTEGER,
    "ratingComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceRequest_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ServiceRequest_code_key" ON "ServiceRequest"("code");
CREATE INDEX "ServiceRequest_status_module_createdAt_idx" ON "ServiceRequest"("status", "module", "createdAt");
CREATE INDEX "ServiceRequest_customerId_createdAt_idx" ON "ServiceRequest"("customerId", "createdAt");
CREATE INDEX "ServiceRequest_providerId_status_idx" ON "ServiceRequest"("providerId", "status");
