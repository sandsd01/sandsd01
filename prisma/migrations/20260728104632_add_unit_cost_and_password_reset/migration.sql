-- AlterTable
ALTER TABLE "products" ADD COLUMN "unitCost" REAL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "resetTokenExpiresAt" DATETIME;
ALTER TABLE "users" ADD COLUMN "resetTokenHash" TEXT;
