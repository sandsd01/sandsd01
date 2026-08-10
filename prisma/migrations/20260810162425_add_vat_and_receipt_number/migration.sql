-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "taxBranchCode" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "receiptNumber" TEXT,
ADD COLUMN     "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "shop_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legalName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.07,
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_receiptNumber_key" ON "sales"("receiptNumber");

