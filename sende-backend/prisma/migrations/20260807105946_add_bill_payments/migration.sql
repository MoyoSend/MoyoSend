-- CreateEnum
CREATE TYPE "BillPaymentType" AS ENUM ('AIRTIME', 'DATA');

-- CreateEnum
CREATE TYPE "BillPaymentStatus" AS ENUM ('CREATED', 'COMPLIANCE_HOLD', 'FUNDS_COLLECTED', 'SENT_TO_PROVIDER', 'SUCCESSFUL', 'FAILED', 'REFUND_INITIATED', 'REFUNDED');

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_transactionId_fkey";

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "billPaymentId" TEXT,
ALTER COLUMN "transactionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "BillPaymentType" NOT NULL,
    "network" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "billerCode" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "sendAmount" BIGINT NOT NULL,
    "sendCurrency" TEXT NOT NULL,
    "ngnAmountMinor" BIGINT NOT NULL,
    "fxRateLocked" DECIMAL(18,8) NOT NULL,
    "feeAmount" BIGINT NOT NULL,
    "status" "BillPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "providerReference" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_idempotencyKey_key" ON "BillPayment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_providerReference_key" ON "BillPayment"("providerReference");

-- CreateIndex
CREATE INDEX "BillPayment_userId_idx" ON "BillPayment"("userId");

-- CreateIndex
CREATE INDEX "BillPayment_status_idx" ON "BillPayment"("status");

-- CreateIndex
CREATE INDEX "LedgerEntry_billPaymentId_idx" ON "LedgerEntry"("billPaymentId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_billPaymentId_fkey" FOREIGN KEY ("billPaymentId") REFERENCES "BillPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
