-- CreateEnum
CREATE TYPE "RentalPricing" AS ENUM ('HOURLY', 'DAILY', 'DISTANCE');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'PAYMENT_FAILED');

-- CreateTable
CREATE TABLE "RentalProvider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "commissionRate" INTEGER NOT NULL DEFAULT 10,
    "temporarilyClosed" BOOLEAN NOT NULL DEFAULT false,
    "scheduledTrips" BOOLEAN NOT NULL DEFAULT true,
    "pickupZoneId" TEXT,
    "pickupTimeMin" INTEGER NOT NULL DEFAULT 15,
    "pickupTimeMax" INTEGER NOT NULL DEFAULT 30,
    "taxPercent" INTEGER NOT NULL DEFAULT 0,
    "ownerEmail" TEXT,
    "ownerPasswordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "airConditioning" BOOLEAN NOT NULL DEFAULT true,
    "fuel" TEXT NOT NULL,
    "transmission" TEXT NOT NULL,
    "engineCc" INTEGER,
    "powerHp" INTEGER,
    "hourlyPrice" INTEGER,
    "dailyPrice" INTEGER,
    "perKmPrice" INTEGER,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleUnit" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "vin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VehicleUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalDriver" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "photoUrl" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "idImageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalDriver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PENDING',
    "pricing" "RentalPricing" NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "duration" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "pickupAddress" TEXT NOT NULL,
    "pickupLatitude" DOUBLE PRECISION,
    "pickupLongitude" DOUBLE PRECISION,
    "destinationAddress" TEXT NOT NULL,
    "destLatitude" DOUBLE PRECISION,
    "destLongitude" DOUBLE PRECISION,
    "note" TEXT,
    "driverId" TEXT,
    "fare" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "extraDiscount" INTEGER NOT NULL DEFAULT 0,
    "extraFee" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "cancellationReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripVehicle" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "unitId" TEXT,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "price" INTEGER NOT NULL,

    CONSTRAINT "TripVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalSettlement" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "tripCount" INTEGER NOT NULL,
    "tripTotal" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "amountDue" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalProvider_slug_key" ON "RentalProvider"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RentalProvider_ownerEmail_key" ON "RentalProvider"("ownerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleUnit_vehicleId_plateNumber_key" ON "VehicleUnit"("vehicleId", "plateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_code_key" ON "Trip"("code");

-- AddForeignKey
ALTER TABLE "RentalProvider" ADD CONSTRAINT "RentalProvider_pickupZoneId_fkey" FOREIGN KEY ("pickupZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "RentalProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleUnit" ADD CONSTRAINT "VehicleUnit_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalDriver" ADD CONSTRAINT "RentalDriver_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "RentalProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "RentalProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "RentalDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "RentalSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripVehicle" ADD CONSTRAINT "TripVehicle_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripVehicle" ADD CONSTRAINT "TripVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripVehicle" ADD CONSTRAINT "TripVehicle_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "VehicleUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalSettlement" ADD CONSTRAINT "RentalSettlement_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "RentalProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

