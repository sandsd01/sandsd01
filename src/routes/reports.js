const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { sendLowStockAlert } = require("../lib/email");

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

router.get("/movements-timeseries", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const movements = await prisma.stockMovement.findMany({
    where: { createdAt: { gte: since } },
    select: { type: true, quantity: true, createdAt: true },
  });

  const byDate = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    byDate.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), in: 0, out: 0 });
  }

  for (const m of movements) {
    const key = m.createdAt.toISOString().slice(0, 10);
    const bucket = byDate.get(key);
    if (bucket) bucket[m.type] += m.quantity;
  }

  res.json(Array.from(byDate.values()));
});

router.post("/send-low-stock-alert", requireRole("admin"), async (_req, res) => {
  const products = await prisma.product.findMany();
  const lowStockProducts = products.filter((p) => p.quantity <= p.reorderLevel);

  const result = await sendLowStockAlert(lowStockProducts);
  res.json({ ...result, count: lowStockProducts.length });
});

module.exports = router;
