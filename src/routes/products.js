const path = require("path");
const fs = require("fs");
const express = require("express");
const QRCode = require("qrcode");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { toCsv, parseCsv } = require("../lib/csv");
const { logAction } = require("../lib/audit");
const { upload } = require("../lib/upload");
const { applyStockMovement, InsufficientStockError } = require("../lib/stock");

const router = express.Router();

const SORTABLE_FIELDS = ["name", "sku", "quantity", "reorderLevel", "category"];
const SUPPLIER_SELECT = { select: { id: true, name: true } };

function buildWhere({ search, category }) {
  const where = { deletedAt: null };
  if (search) {
    // `mode: "insensitive"` is required on PostgreSQL: unlike SQLite, `contains`
    // is case-sensitive there by default.
    where.OR = [
      { sku: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
    ];
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

router.get("/lookup", async (req, res) => {
  const code = (req.query.code || "").trim();
  if (!code) {
    return res.status(400).json({ error: "code is required" });
  }

  const product = await prisma.product.findFirst({
    where: { deletedAt: null, OR: [{ sku: code }, { barcode: code }] },
  });
  if (!product) return res.status(404).json({ error: "No product matches that code" });
  res.json(product);
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
    { label: "barcode", value: (p) => p.barcode },
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
    const barcode = row.barcode?.trim() || null;
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
        data: { name, unit, category, reorderLevel, unitCost, barcode },
      });
      updated++;
    } else {
      await prisma.product.create({
        data: { sku, name, unit, category, reorderLevel, unitCost, barcode, createdById: req.user.id },
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

router.get("/:id/modifier-groups", async (req, res) => {
  const productId = Number(req.params.id);
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const groups = await prisma.modifierGroup.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });
  res.json(groups);
});

router.post("/:id/modifier-groups", requireRole("admin"), async (req, res) => {
  const productId = Number(req.params.id);
  const { name, selectionType, required, sortOrder } = req.body || {};

  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!["single", "multiple"].includes(selectionType)) {
    return res.status(400).json({ error: "selectionType must be 'single' or 'multiple'" });
  }

  const group = await prisma.modifierGroup.create({
    data: {
      productId,
      name,
      selectionType,
      required: required !== undefined ? Boolean(required) : false,
      sortOrder: sortOrder !== undefined && sortOrder !== null ? Number(sortOrder) : 0,
    },
    include: { options: true },
  });

  await logAction({
    userId: req.user.id,
    action: "modifier_group_create",
    entityType: "modifier_group",
    entityId: group.id,
    details: { productId, name: group.name },
  });

  res.status(201).json(group);
});

router.patch("/modifier-groups/:groupId", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.groupId);
  const { name, selectionType, required, sortOrder } = req.body || {};

  const existing = await prisma.modifierGroup.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Modifier group not found" });

  if (selectionType !== undefined && !["single", "multiple"].includes(selectionType)) {
    return res.status(400).json({ error: "selectionType must be 'single' or 'multiple'" });
  }

  const group = await prisma.modifierGroup.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(selectionType !== undefined && { selectionType }),
      ...(required !== undefined && { required: Boolean(required) }),
      ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
    },
    include: { options: true },
  });

  await logAction({
    userId: req.user.id,
    action: "modifier_group_update",
    entityType: "modifier_group",
    entityId: group.id,
    details: { name: group.name },
  });

  res.json(group);
});

router.delete("/modifier-groups/:groupId", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.groupId);
  const existing = await prisma.modifierGroup.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Modifier group not found" });

  await prisma.modifierGroup.delete({ where: { id } });

  await logAction({
    userId: req.user.id,
    action: "modifier_group_delete",
    entityType: "modifier_group",
    entityId: id,
    details: { name: existing.name },
  });

  res.status(204).send();
});

router.post("/modifier-groups/:groupId/options", requireRole("admin"), async (req, res) => {
  const modifierGroupId = Number(req.params.groupId);
  const { name, priceDelta, sortOrder } = req.body || {};

  const group = await prisma.modifierGroup.findUnique({ where: { id: modifierGroupId } });
  if (!group) return res.status(404).json({ error: "Modifier group not found" });

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const option = await prisma.modifierOption.create({
    data: {
      modifierGroupId,
      name,
      priceDelta:
        priceDelta !== undefined && priceDelta !== null && priceDelta !== "" ? Number(priceDelta) : 0,
      sortOrder: sortOrder !== undefined && sortOrder !== null ? Number(sortOrder) : 0,
    },
  });

  await logAction({
    userId: req.user.id,
    action: "modifier_option_create",
    entityType: "modifier_option",
    entityId: option.id,
    details: { modifierGroupId, name: option.name },
  });

  res.status(201).json(option);
});

router.patch("/modifier-options/:optionId", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.optionId);
  const { name, priceDelta, sortOrder } = req.body || {};

  const existing = await prisma.modifierOption.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Modifier option not found" });

  const option = await prisma.modifierOption.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(priceDelta !== undefined && {
        priceDelta: priceDelta !== null && priceDelta !== "" ? Number(priceDelta) : 0,
      }),
      ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
    },
  });

  await logAction({
    userId: req.user.id,
    action: "modifier_option_update",
    entityType: "modifier_option",
    entityId: option.id,
    details: { name: option.name },
  });

  res.json(option);
});

router.delete("/modifier-options/:optionId", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.optionId);
  const existing = await prisma.modifierOption.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Modifier option not found" });

  await prisma.modifierOption.delete({ where: { id } });

  await logAction({
    userId: req.user.id,
    action: "modifier_option_delete",
    entityType: "modifier_option",
    entityId: id,
    details: { name: existing.name },
  });

  res.status(204).send();
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
  const { sku, name, unit, category, reorderLevel, supplierId, unitCost, sellingPrice, barcode } =
    req.body || {};
  if (!sku || !name || !unit) {
    return res.status(400).json({ error: "sku, name, and unit are required" });
  }

  const existing = await prisma.product.findUnique({ where: { sku } });
  if (existing) {
    return res.status(409).json({ error: "A product with this sku already exists" });
  }

  if (barcode) {
    const existingBarcode = await prisma.product.findUnique({ where: { barcode } });
    if (existingBarcode) {
      return res.status(409).json({ error: "A product with this barcode already exists" });
    }
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
      sellingPrice:
        sellingPrice !== undefined && sellingPrice !== null && sellingPrice !== ""
          ? Number(sellingPrice)
          : null,
      barcode: barcode || null,
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
  const { name, unit, reorderLevel, sku, category, supplierId, unitCost, sellingPrice, barcode } =
    req.body || {};
  const id = Number(req.params.id);

  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  if (barcode) {
    const existingBarcode = await prisma.product.findFirst({ where: { barcode, id: { not: id } } });
    if (existingBarcode) {
      return res.status(409).json({ error: "A product with this barcode already exists" });
    }
  }

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
      ...(sellingPrice !== undefined && {
        sellingPrice: sellingPrice !== null && sellingPrice !== "" ? Number(sellingPrice) : null,
      }),
      ...(barcode !== undefined && { barcode: barcode || null }),
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

  const hasPurchaseOrderItems = await prisma.purchaseOrderItem.findFirst({ where: { productId: id } });
  if (hasPurchaseOrderItems) {
    return res.status(409).json({ error: "Cannot permanently delete a product referenced by a purchase order" });
  }

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

router.get("/:id/qrcode", async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const payload = product.barcode || product.sku;
  const png = await QRCode.toBuffer(payload, { width: 256, margin: 1 });
  res.setHeader("Content-Type", "image/png");
  res.send(png);
});

router.get("/:id/movements", async (req, res) => {
  const productId = Number(req.params.id);
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    include: { location: { select: { id: true, name: true } } },
  });
  res.json(movements);
});

router.get("/:id/movements/by-location", async (req, res) => {
  const productId = Number(req.params.id);
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    include: { location: { select: { id: true, name: true } } },
  });

  const byLocation = new Map();
  for (const m of movements) {
    const key = m.locationId ?? "unassigned";
    const label = m.location?.name ?? "Unassigned";
    const delta = m.type === "in" ? m.quantity : -m.quantity;
    const entry = byLocation.get(key) || { locationId: m.locationId, name: label, quantity: 0 };
    entry.quantity += delta;
    byLocation.set(key, entry);
  }

  res.json([...byLocation.values()]);
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
  const { type, quantity, note, locationId } = req.body || {};

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

  let resolvedLocationId = null;
  if (locationId !== undefined && locationId !== null && locationId !== "") {
    const location = await prisma.location.findUnique({ where: { id: Number(locationId) } });
    if (!location) return res.status(400).json({ error: "Location not found" });
    resolvedLocationId = location.id;
  }

  let movement, updatedProduct;
  try {
    ({ movement, updatedProduct } = await prisma.$transaction((tx) =>
      applyStockMovement(tx, {
        productId,
        locationId: resolvedLocationId,
        type,
        quantity,
        note,
        createdById: req.user.id,
      })
    ));
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

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

  if (movement.locationId) {
    const locationStock = await prisma.locationStock.findUnique({
      where: { productId_locationId: { productId, locationId: movement.locationId } },
    });
    const currentLocationQty = locationStock?.quantity ?? 0;
    if (currentLocationQty + reverseDelta < 0) {
      return res.status(400).json({
        error: "Cannot delete this movement: it would take location stock negative",
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.delete({ where: { id: movementId } });
    await tx.product.update({
      where: { id: productId },
      data: { quantity: { increment: reverseDelta } },
    });
    if (movement.locationId) {
      await tx.locationStock.upsert({
        where: { productId_locationId: { productId, locationId: movement.locationId } },
        create: { productId, locationId: movement.locationId, quantity: reverseDelta },
        update: { quantity: { increment: reverseDelta } },
      });
    }
  });

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
