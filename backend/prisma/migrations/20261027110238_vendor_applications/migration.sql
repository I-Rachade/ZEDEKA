-- CreateEnum
CREATE TYPE "VendorApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MomoOperator" AS ENUM ('TMONEY', 'FLOOZ');

-- CreateEnum
CREATE TYPE "VendorPlan" AS ENUM ('COMMISSION', 'SUBSCRIPTION');

-- CreateTable
CREATE TABLE "VendorApplication" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "VendorApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "businessName" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "deliveryTimeMin" INTEGER NOT NULL,
    "deliveryTimeMax" INTEGER NOT NULL,
    "logoPath" TEXT NOT NULL,
    "coverPath" TEXT NOT NULL,
    "ownerFirstName" TEXT NOT NULL,
    "ownerLastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "momoOperator" "MomoOperator" NOT NULL,
    "momoNumber" TEXT NOT NULL,
    "rccm" TEXT,
    "nif" TEXT,
    "legalDocPath" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "plan" "VendorPlan" NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "VendorApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorApplication_reference_key" ON "VendorApplication"("reference");

-- CreateIndex
CREATE INDEX "VendorApplication_status_createdAt_idx" ON "VendorApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VendorApplication_email_idx" ON "VendorApplication"("email");

-- AddForeignKey
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
