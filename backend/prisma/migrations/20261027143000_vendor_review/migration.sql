-- AlterTable
ALTER TABLE "VendorApplication" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "restaurantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "VendorApplication_restaurantId_key" ON "VendorApplication"("restaurantId");

-- AddForeignKey
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

