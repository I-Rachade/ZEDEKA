-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "alertedAdminAt" TIMESTAMP(3),
ADD COLUMN     "refundDue" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RentalProvider" ADD COLUMN     "closedUntil" TIMESTAMP(3),
ADD COLUMN     "sessionsValidFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "closedUntil" TIMESTAMP(3),
ADD COLUMN     "sessionsValidFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "alertedAdminAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrderEdit" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "oldTotal" INTEGER NOT NULL,
    "newTotal" INTEGER NOT NULL,
    "refund" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderEdit_orderId_idx" ON "OrderEdit"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_role_subject_idx" ON "PushSubscription"("role", "subject");

-- CreateIndex
CREATE INDEX "PasswordReset_role_subject_createdAt_idx" ON "PasswordReset"("role", "subject", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderEdit" ADD CONSTRAINT "OrderEdit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

