-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "subscriptionFee" INTEGER;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "vendorSubscriptionFee" INTEGER NOT NULL DEFAULT 15000;

-- AlterTable
ALTER TABLE "VendorApplication" ADD COLUMN     "monthlyFee" INTEGER;
