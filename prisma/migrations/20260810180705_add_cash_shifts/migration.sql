-- CreateEnum
CREATE TYPE "CashShiftStatus" AS ENUM ('open', 'closed');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "cashShiftId" INTEGER;

-- CreateTable
CREATE TABLE "cash_shifts" (
    "id" SERIAL NOT NULL,
    "locationId" INTEGER NOT NULL,
    "openedById" INTEGER NOT NULL,
    "closedById" INTEGER,
    "status" "CashShiftStatus" NOT NULL DEFAULT 'open',
    "openingFloat" DECIMAL(12,2) NOT NULL,
    "countedCash" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "openingNote" TEXT,
    "closingNote" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "cash_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

