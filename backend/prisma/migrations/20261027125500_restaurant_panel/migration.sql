-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PREPARING';
ALTER TYPE "OrderStatus" ADD VALUE 'READY';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "prepMinutes" INTEGER,
ADD COLUMN     "preparingAt" TIMESTAMP(3),
ADD COLUMN     "readyAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "minOrderAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openingHours" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "ownerEmail" TEXT,
ADD COLUMN     "ownerPasswordHash" TEXT,
ADD COLUMN     "temporarilyClosed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_ownerEmail_key" ON "Restaurant"("ownerEmail");

