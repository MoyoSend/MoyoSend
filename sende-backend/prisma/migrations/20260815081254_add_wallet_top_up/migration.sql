-- CreateEnum
CREATE TYPE "WalletTopUpStatus" AS ENUM ('CREATED', 'FUNDS_COLLECTED', 'FAILED', 'REFUND_INITIATED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'PLATFORM_CASH';

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "walletTopUpId" TEXT;

-- CreateTable
CREATE TABLE "WalletTopUp" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "WalletTopUpStatus" NOT NULL DEFAULT 'CREATED',
    "paymentIntentId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTopUp_idempotencyKey_key" ON "WalletTopUp"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTopUp_paymentIntentId_key" ON "WalletTopUp"("paymentIntentId");

-- CreateIndex
CREATE INDEX "WalletTopUp_userId_idx" ON "WalletTopUp"("userId");

-- CreateIndex
CREATE INDEX "WalletTopUp_status_idx" ON "WalletTopUp"("status");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletTopUpId_idx" ON "LedgerEntry"("walletTopUpId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletTopUpId_fkey" FOREIGN KEY ("walletTopUpId") REFERENCES "WalletTopUp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTopUp" ADD CONSTRAINT "WalletTopUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
