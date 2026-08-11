/*
  Warnings:

  - A unique constraint covering the columns `[providerTxRef]` on the table `BillPayment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "BillPayment" ADD COLUMN     "providerTxRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_providerTxRef_key" ON "BillPayment"("providerTxRef");
