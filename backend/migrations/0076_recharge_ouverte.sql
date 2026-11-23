-- Recharge ouverte aux motos hors Zedeka (src/charging.ts) : stations (bornes de recharge, échange de batteries),
-- réservations avec ticket et passages notés à la station.
-- Migration additive : deux tables, aucune donnée touchée.

CREATE TABLE "ChargingStation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BOTH',
    "address" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "chargePoints" INTEGER NOT NULL DEFAULT 2,
    "swapBays" INTEGER NOT NULL DEFAULT 1,
    "chargePrice" INTEGER NOT NULL DEFAULT 1000,
    "swapPrice" INTEGER NOT NULL DEFAULT 1500,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "opensAt" TEXT NOT NULL DEFAULT '07:00',
    "closesAt" TEXT NOT NULL DEFAULT '21:00',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ChargingBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "bikeModel" TEXT,
    "driverId" TEXT,
    "price" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "source" TEXT NOT NULL DEFAULT 'ONLINE',
    "paymentMethod" TEXT,
    "paidAmount" INTEGER,
    "paymentRef" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInAt" DATETIME,
    "doneAt" DATETIME,
    "cancelledAt" DATETIME,
    "handledBy" TEXT,
    CONSTRAINT "ChargingBooking_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "ChargingStation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChargingBooking_code_key" ON "ChargingBooking"("code");
CREATE INDEX "ChargingBooking_stationId_startsAt_idx" ON "ChargingBooking"("stationId", "startsAt");
CREATE INDEX "ChargingBooking_phone_status_idx" ON "ChargingBooking"("phone", "status");
CREATE INDEX "ChargingBooking_status_startsAt_idx" ON "ChargingBooking"("status", "startsAt");
