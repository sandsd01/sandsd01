const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { sendLowStockAlert, sendDailySummary } = require("../lib/email");
const { buildSummaryPdf } = require("../lib/pdf");

const router = express.Router();

router.use(authenticate);

async function getSummary() {
  const products = await prisma.product.findMany({ where: { deletedAt: null } });
  const totalProducts = products.length;
  const totalQuantity = products.reduce((sum, p) => sum + p.quantity, 0);
  const totalValue = products.reduce((sum, p) => sum + p.quantity * (p.unitCost || 0), 0);
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

  return {
    totalProducts,
    totalQuantity,
    totalValue,
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
  };
}

router.get("/summary", async (_req, res) => {
  res.json(await getSummary());
});

router.get("/summary/pdf", async (_req, res) => {
  const summary = await getSummary();
  const pdf = await buildSummaryPdf(summary);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=\"inventory-summary.pdf\"");
  res.send(pdf);
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

router.get("/activity-log", requireRole("admin"), async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20));

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { email: true } } },
    }),
    prisma.auditLog.count(),
  ]);

  res.json({
    data: data.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      details: log.details ? JSON.parse(log.details) : null,
      userEmail: log.user.email,
      createdAt: log.createdAt,
    })),
    total,
    page,
    pageSize,
  });
});

router.get("/sales-summary", async (req, res) => {
  const { locationId, from, to } = req.query;
  const where = { status: "completed" };
  if (locationId) where.locationId = Number(locationId);
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  let scopedLocationId = null;
  if (req.user.role === "staff") {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { homeLocationId: true },
    });
    if (user?.homeLocationId) {
      scopedLocationId = user.homeLocationId;
      where.locationId = scopedLocationId;
    }
  }

  const sales = await prisma.sale.findMany({
    where,
    select: { id: true, total: true, locationId: true },
  });
  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
  const totalSaleCount = sales.length;

  let revenueByLocation = [];
  if (!scopedLocationId) {
    const byLocation = new Map();
    for (const s of sales) {
      const entry = byLocation.get(s.locationId) || { locationId: s.locationId, revenue: 0, count: 0 };
      entry.revenue += s.total;
      entry.count += 1;
      byLocation.set(s.locationId, entry);
    }
    const locations = await prisma.location.findMany({
      where: { id: { in: [...byLocation.keys()] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(locations.map((l) => [l.id, l.name]));
    revenueByLocation = [...byLocation.values()].map((entry) => ({
      ...entry,
      name: nameById.get(entry.locationId) ?? "Unknown",
    }));
  }

  const saleIds = sales.map((s) => s.id);
  const topProductsRaw = saleIds.length
    ? await prisma.saleItem.groupBy({
        by: ["productId"],
        where: { saleId: { in: saleIds } },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { lineTotal: "desc" } },
        take: 10,
      })
    : [];

  const products = await prisma.product.findMany({
    where: { id: { in: topProductsRaw.map((p) => p.productId) } },
    select: { id: true, sku: true, name: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const topProducts = topProductsRaw.map((p) => ({
    productId: p.productId,
    product: productById.get(p.productId) ?? null,
    quantitySold: p._sum.quantity ?? 0,
    revenue: p._sum.lineTotal ?? 0,
  }));

  res.json({
    totalRevenue,
    totalSaleCount,
    revenueByLocation,
    topProducts,
  });
});

router.post("/send-low-stock-alert", requireRole("admin"), async (_req, res) => {
  const summary = await getSummary();
  const result = await sendLowStockAlert(summary.lowStockProducts);
  res.json({ ...result, count: summary.lowStockProducts.length });
});

router.post("/send-daily-summary", requireRole("admin"), async (_req, res) => {
  const summary = await getSummary();
  const result = await sendDailySummary(summary);
  res.json(result);
});

module.exports = router;
module.exports.getSummary = getSummary;
