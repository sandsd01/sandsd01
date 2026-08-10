process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:devpass@localhost:5432/sandsd01_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const bcrypt = require("bcryptjs");
const prisma = require("../../prisma/client");

async function resetDb() {
  // Shop settings are a singleton, not FK-linked, but must reset too or VAT
  // config leaks between test files.
  await prisma.shopSetting.deleteMany();
  await prisma.saleItemModifier.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.locationStock.deleteMany();
  await prisma.modifierOption.deleteMany();
  await prisma.modifierGroup.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.location.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser({ email, password = "password123", role = "staff" }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({ data: { email, passwordHash, role } });
}

module.exports = { prisma, resetDb, createUser };
