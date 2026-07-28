process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./test.db";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const bcrypt = require("bcryptjs");
const prisma = require("../../prisma/client");

async function resetDb() {
  await prisma.stockMovement.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser({ email, password = "password123", role = "staff" }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({ data: { email, passwordHash, role } });
}

module.exports = { prisma, resetDb, createUser };
