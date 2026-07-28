const path = require("path");
const fs = require("fs");
const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { toCsv, parseCsv } = require("../lib/csv");
const { logAction } = require("../lib/audit");
const { upload } = require("../lib/upload");

const router = express.Router();

const SORTABLE_FIELDS = ["name", "sku", "quantity", "reorderLevel", "category"];
const SUPPLIER_SELECT = { select: { id: true, name: true } };

function buildWhere({ search, category }) {
  const where = { deletedAt: null };
  if (search) {
    where.OR = [{ sku: { contains: search } }, { name: { contains: search } }];
  }
  if (category) {
    where.category = category;
  }
  return where;
}

router.use(authenticate);

router.get("/", async (req, res) => {
  const { search, category } = req.query;
  const where = buildWhere({ search, category });

  const sortBy = SORTABLE_FIELDS.includes(req.query.sortBy) ? req.query.sortBy : "name";
  const sortDir = req.query.sortDir === "desc" ? "desc" : "asc";

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20));

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { supplier: SUPPLIER_SELECT },
    }),
    prisma.product.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
});

router.get("/categories", async (_req, res) => {
  const rows = await prisma.product.findMany({
    where: { category: { not: null }, deletedAt: null },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  res.json(rows.map((r) => r.category));
});

router.get("/trash", requireRole("admin"), async (_req, res) => {
  const products = await prisma.product.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
  res.json(products);
});

router.get("/export", async (req, res) => {
  const where = buildWhere({ search: req.query.search, category: req.query.category });
  const products = await prisma.product.findMany({ where, orderBy: { name: "asc" } });
  const csv = toCsv(products, [
    { label: "sku", value: (p) => p.sku },
    { label: "name", value: (p) => p.name },
    { label: "unit", value: (p) => p.unit },
    { label: "category", value: (p) => p.category },
    { label: "unitCost", value: (p) => p.unitCost },
    { label: "quantity", value: (p) => p.quantity },
    { label: "reorderLevel", value: (p) => p.reorderLevel },
  ]);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"products.csv\"");
  res.send(csv);
});

router.post("/import", requireRole("admin"), async (req, res) => {
  const { csv } = req.body || {};
  if (typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ error: "csv (string) is required" });
  }

  let rows;
  try {
    rows = parseCsv(csv);
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  let created = 0;
  let updated = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sku = row.sku?.trim();
    const name = row.name?.trim();
    const unit = row.unit?.trim();
    const category = row.category?.trim() || null;
    const reorderLevel = row.reorderLevel !== undefined ? Number(row.reorderLevel) : 0;
    const unitCost =
      row.unitCost !== undefined && row.unitCost !== "" ? Number(row.unitCost) : null;

    if (!sku || !name || !unit) {
      errors.push({ row: i + 2, error: "sku, name, and unit are required" });
      continue;
    }
    if (Number.isNaN(reorderLevel)) {
      errors.push({ row: i + 2, error: "reorderLevel must be a number" });
      continue;
    }
    if (unitCost !== null && Number.isNaN(unitCost)) {
      errors.push({ row: i + 2, error: "unitCost must be a number" });
      continue;
    }

    const existing = await prisma.product.findUnique({ where: { sku } });
    if (existing) {
      await prisma.product.update({
        where: { sku },
        data: { name, unit, category, reorderLevel, unitCost },
      });
      updated++;
    } else {
      await prisma.product.create({
        data: { sku, name, unit, category, reorderLevel, unitCost, createdById: req.user.id },
      });
      created++;
    }
  }

  await logAction({
    userId: req.user.id,
    action: "import",
    entityType: "product",
    details: { created, updated, errorCount: errors.length },
  });

  res.json({ created, updated, errors });
});

router.post("/bulk-delete", requireRole("admin"), async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids (non-empty array) is required" });
  }
  const numericIds = ids.map(Number).filter((id) => Number.isInteger(id));

  const result = await prisma.product.updateMany({
    where: { id: { in: numericIds }, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  await logAction({
    userId: req.user.id,
    action: "bulk_delete",
    entityType: "product",
    details: { ids: numericIds, count: result.count },
  });

  res.json({ deleted: result.count });
});

router.post("/bulk-category", requireRole("admin"), async (req, res) => {
  const { ids, category } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids (non-empty array) is required" });
  }
  const numericIds = ids.map(Number).filter((id) => Number.isInteger(id));

  const result = await prisma.product.updateMany({
    where: { id: { in: numericIds }, deletedAt: null },
    data: { category: category || null },
  });

  await logAction({
    userId: req.user.id,
    action: "bulk_category_update",
    entityType: "product",
    details: { ids: numericIds, category, count: result.count },
  });

  res.json({ updated: result.count });
});

router.get("/:id", async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { id: Number(req.params.id), deletedAt: null },
    include: { supplier: SUPPLIER_SELECT },
  });
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { sku, name, unit, category, reorderLevel, supplierId, unitCost } = req.body || {};
  if (!sku || !name || !unit) {
    return res.status(400).json({ error: "sku, name, and unit are required" });
  }

  const existing = await prisma.product.findUnique({ where: { sku } });
  if (existing) {
    return res.status(409).json({ error: "A product with this sku already exists" });
  }

  const product = await prisma.product.create({
    data: {
      sku,
      name,
      unit,
      category: category || null,
      reorderLevel: reorderLevel ?? 0,
      supplierId: supplierId ? Number(supplierId) : null,
      unitCost: unitCost !== undefined && unitCost !== null && unitCost !== "" ? Number(unitCost) : null,
      createdById: req.user.id,
    },
  });

  await logAction({
    userId: req.user.id,
    action: "create",
    entityType: "product",
    entityId: product.id,
    details: { sku: product.sku },
  });

  res.status(201).json(product);
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const { name, unit, reorderLevel, sku, category, supplierId, unitCost } = req.body || {};
  const id = Number(req.params.id);

  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(unit !== undefined && { unit }),
      ...(reorderLevel !== undefined && { reorderLevel }),
      ...(sku !== undefined && { sku }),
      ...(category !== undefined && { category: category || null }),
      ...(supplierId !== undefined && { supplierId: supplierId ? Number(supplierId) : null }),
      ...(unitCost !== undefined && {
        unitCost: unitCost !== null && unitCost !== "" ? Number(unitCost) : null,
      }),
    },
  });

  await logAction({
    userId: req.user.id,
    action: "update",
    entityType: "product",
    entityId: product.id,
    details: { sku: product.sku },
  });

  res.json(product);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });

  await logAction({
    userId: req.user.id,
    action: "delete",
    entityType: "product",
    entityId: id,
    details: { sku: existing.sku },
  });

  res.status(204).send();
});

router.post("/:id/restore", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!existing) return res.status(404).json({ error: "Deleted product not found" });

  const product = await prisma.product.update({ where: { id }, data: { deletedAt: null } });

  await logAction({
    userId: req.user.id,
    action: "restore",
    entityType: "product",
    entityId: id,
    details: { sku: existing.sku },
  });

  res.json(product);
});

router.delete("/:id/permanent", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!existing) return res.status(404).json({ error: "Deleted product not found" });

  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { productId: id } }),
    prisma.product.delete({ where: { id } }),
  ]);

  if (existing.imageUrl) {
    const imagePath = path.join(__dirname, "../..", existing.imageUrl.replace(/^\//, ""));
    fs.unlink(imagePath, () => {});
  }

  await logAction({
    userId: req.user.id,
    action: "permanent_delete",
    entityType: "product",
    entityId: id,
    details: { sku: existing.sku },
  });

  res.status(204).send();
});

router.post(
  "/:id/image",
  requireRole("admin"),
  (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: "Product not found" });
    if (!req.file) return res.status(400).json({ error: "image file is required" });

    if (existing.imageUrl) {
      const oldPath = path.join(__dirname, "../..", existing.imageUrl.replace(/^\//, ""));
      fs.unlink(oldPath, () => {});
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const product = await prisma.product.update({ where: { id }, data: { imageUrl } });
    res.json(product);
  }
);

router.get("/:id/movements", async (req, res) => {
  const productId = Number(req.params.id);
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
  });
  res.json(movements);
});

router.get("/:id/movements/export", async (req, res) => {
  const productId = Number(req.params.id);
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
  });
  const csv = toCsv(movements, [
    { label: "date", value: (m) => m.createdAt.toISOString() },
    { label: "type", value: (m) => m.type },
    { label: "quantity", value: (m) => m.quantity },
    { label: "note", value: (m) => m.note },
  ]);
  const safeSku = product.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${safeSku}-movements.csv"`);
  res.send(csv);
});

router.post("/:id/movements", requireRole("admin", "staff"), async (req, res) => {
  const productId = Number(req.params.id);
  const { type, quantity, note } = req.body || {};

  if (!["in", "out"].includes(type)) {
    return res.status(400).json({ error: "type must be 'in' or 'out'" });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "quantity must be a positive integer" });
  }

  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  if (type === "out" && product.quantity < quantity) {
    return res.status(400).json({ error: "Insufficient stock for this movement" });
  }

  const delta = type === "in" ? quantity : -quantity;

  const [movement, updatedProduct] = await prisma.$transaction([
    prisma.stockMovement.create({
      data: { productId, type, quantity, note, createdById: req.user.id },
    }),
    prisma.product.update({
      where: { id: productId },
      data: { quantity: { increment: delta } },
    }),
  ]);

  await logAction({
    userId: req.user.id,
    action: "movement_create",
    entityType: "stock_movement",
    entityId: movement.id,
    details: { productId, type, quantity },
  });

  req.app.locals.onStockMovement?.(updatedProduct, product.quantity);

  res.status(201).json(movement);
});

router.delete("/:id/movements/:movementId", requireRole("admin"), async (req, res) => {
  const productId = Number(req.params.id);
  const movementId = Number(req.params.movementId);

  const movement = await prisma.stockMovement.findUnique({ where: { id: movementId } });
  if (!movement || movement.productId !== productId) {
    return res.status(404).json({ error: "Movement not found" });
  }

  const reverseDelta = movement.type === "in" ? -movement.quantity : movement.quantity;
  const product = await prisma.product.findUnique({ where: { id: productId } });

  if (product.quantity + reverseDelta < 0) {
    return res.status(400).json({
      error: "Cannot delete this movement: it would take quantity negative",
    });
  }

  await prisma.$transaction([
    prisma.stockMovement.delete({ where: { id: movementId } }),
    prisma.product.update({
      where: { id: productId },
      data: { quantity: { increment: reverseDelta } },
    }),
  ]);

  await logAction({
    userId: req.user.id,
    action: "movement_delete",
    entityType: "stock_movement",
    entityId: movementId,
    details: { productId, type: movement.type, quantity: movement.quantity },
  });

  res.status(204).send();
});

module.exports = router;
