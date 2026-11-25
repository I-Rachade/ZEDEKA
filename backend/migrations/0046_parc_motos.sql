-- Parc de motos de Zedeka pour les livreurs salariés, et historique des prises de moto.
-- Migration additive : nouvelles tables seulement.

CREATE TABLE "Motorbike" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plate" TEXT NOT NULL,
    "label" TEXT,
    "note" TEXT,
    "photoKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "driverId" TEXT,
    "assignedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Motorbike_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Motorbike_plate_key" ON "Motorbike"("plate");
CREATE UNIQUE INDEX "Motorbike_driverId_key" ON "Motorbike"("driverId");

CREATE TABLE "MotorbikeShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "motorbikeId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "assignedBy" TEXT,
    CONSTRAINT "MotorbikeShift_motorbikeId_fkey" FOREIGN KEY ("motorbikeId") REFERENCES "Motorbike" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MotorbikeShift_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MotorbikeShift_motorbikeId_startedAt_idx" ON "MotorbikeShift"("motorbikeId", "startedAt");
CREATE INDEX "MotorbikeShift_driverId_startedAt_idx" ON "MotorbikeShift"("driverId", "startedAt");
