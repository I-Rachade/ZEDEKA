-- Abonnements de transport scolaire (src/school.ts) : écolier (inscrit par un parent) et étudiant (inscrit lui-même).
-- Trajets maison-école aux jours et heures fixés, assurés par un conducteur Course Zed attitré ; codes de remise,
-- absences, jours fériés, paiements mensuels encaissés par l'équipe. Tarifs indicatifs dans les réglages.
-- Migration additive : cinq tables, trois colonnes sur Driver et six colonnes de réglages, aucune donnée touchée.

CREATE TABLE "SchoolPass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "riderName" TEXT NOT NULL,
    "riderGrade" TEXT,
    "schoolName" TEXT NOT NULL,
    "schoolAddress" TEXT NOT NULL,
    "schoolLatitude" REAL,
    "schoolLongitude" REAL,
    "homeAddress" TEXT NOT NULL,
    "homeLatitude" REAL,
    "homeLongitude" REAL,
    "schedule" TEXT NOT NULL,
    "emergencyName" TEXT NOT NULL,
    "emergencyPhone" TEXT NOT NULL,
    "emergency2Name" TEXT,
    "emergency2Phone" TEXT,
    "healthNote" TEXT,
    "note" TEXT,
    "homeCode" TEXT,
    "schoolCode" TEXT,
    "monthlyFee" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "statusNote" TEXT,
    "startsOn" TEXT,
    "driverId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "SchoolPass_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SchoolPass_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SchoolPass_customerId_idx" ON "SchoolPass"("customerId");
CREATE INDEX "SchoolPass_status_kind_idx" ON "SchoolPass"("status", "kind");
CREATE INDEX "SchoolPass_driverId_status_idx" ON "SchoolPass"("driverId", "status");

CREATE TABLE "SchoolPassPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "passId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "recordedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchoolPassPayment_passId_fkey" FOREIGN KEY ("passId") REFERENCES "SchoolPass" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolPassPayment_passId_month_key" ON "SchoolPassPayment"("passId", "month");
CREATE INDEX "SchoolPassPayment_createdAt_idx" ON "SchoolPassPayment"("createdAt");

CREATE TABLE "SchoolAbsence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "passId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "leg" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchoolAbsence_passId_fkey" FOREIGN KEY ("passId") REFERENCES "SchoolPass" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolAbsence_passId_date_leg_key" ON "SchoolAbsence"("passId", "date", "leg");

CREATE TABLE "SchoolHoliday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ALL',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SchoolHoliday_date_kind_key" ON "SchoolHoliday"("date", "kind");

CREATE TABLE "SchoolTrip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "passId" TEXT NOT NULL,
    "driverId" TEXT,
    "date" TEXT NOT NULL,
    "leg" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "startedAt" DATETIME,
    "pickedUpAt" DATETIME,
    "droppedAt" DATETIME,
    "dropLatitude" REAL,
    "dropLongitude" REAL,
    "codeSkipped" BOOLEAN NOT NULL DEFAULT false,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "lateAlertedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchoolTrip_passId_fkey" FOREIGN KEY ("passId") REFERENCES "SchoolPass" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SchoolTrip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolTrip_passId_date_leg_key" ON "SchoolTrip"("passId", "date", "leg");
CREATE INDEX "SchoolTrip_driverId_date_idx" ON "SchoolTrip"("driverId", "date");
CREATE INDEX "SchoolTrip_date_status_idx" ON "SchoolTrip"("date", "status");

ALTER TABLE "Driver" ADD COLUMN "schoolCleared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Driver" ADD COLUMN "schoolClearedAt" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "schoolClearedBy" TEXT;

ALTER TABLE "Settings" ADD COLUMN "schoolMonthlyFee" INTEGER NOT NULL DEFAULT 30000;
ALTER TABLE "Settings" ADD COLUMN "schoolOneWayFee" INTEGER NOT NULL DEFAULT 18000;
ALTER TABLE "Settings" ADD COLUMN "studentMonthlyFee" INTEGER NOT NULL DEFAULT 25000;
ALTER TABLE "Settings" ADD COLUMN "studentOneWayFee" INTEGER NOT NULL DEFAULT 15000;
ALTER TABLE "Settings" ADD COLUMN "schoolGraceDays" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Settings" ADD COLUMN "schoolMaxPerDriver" INTEGER NOT NULL DEFAULT 4;
