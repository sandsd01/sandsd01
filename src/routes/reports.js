const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

router.get("/summary", async (_req, res) => {
  const products = await prisma.product.findMany();
  const totalProducts = products.length;
  const totalQuantity = products.reduce((sum, p) => sum + p.quantity, 0);
  const lowStockProducts = products
    .filter((p) => p.quantity <= p.reorderLevel)
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      quantity: p.quantity,
      reorderLevel: p.reorderLevel,
    }));

  const recentMovements = await prisma.stockMovement.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      product: { select: { sku: true, name: true } },
      createdBy: { select: { email: true } },
    },
  });

  res.json({
    totalProducts,
    totalQuantity,
    lowStockCount: lowStockProducts.length,
    lowStockProducts,
    recentMovements: recentMovements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      note: m.note,
      createdAt: m.createdAt,
      product: m.product,
      createdByEmail: m.createdBy.email,
    })),
  });
});

module.exports = router;
