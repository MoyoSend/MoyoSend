/*
  Warnings:

  - A unique constraint covering the columns `[paymentIntentId]` on the table `BillPayment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "BillPayment" ADD COLUMN     "paymentIntentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_paymentIntentId_key" ON "BillPayment"("paymentIntentId");
