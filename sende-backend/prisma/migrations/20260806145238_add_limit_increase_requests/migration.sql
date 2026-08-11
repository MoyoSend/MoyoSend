-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyLimitOverrideMinor" BIGINT;

-- CreateTable
CREATE TABLE "LimitIncreaseRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "vendorReference" TEXT NOT NULL,
    "verificationUrl" TEXT,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LimitIncreaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LimitIncreaseRequest_vendorReference_key" ON "LimitIncreaseRequest"("vendorReference");

-- CreateIndex
CREATE INDEX "LimitIncreaseRequest_userId_idx" ON "LimitIncreaseRequest"("userId");

-- AddForeignKey
ALTER TABLE "LimitIncreaseRequest" ADD CONSTRAINT "LimitIncreaseRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
