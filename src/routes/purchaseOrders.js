const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAction } = require("../lib/audit");

const router = express.Router();

const SUPPLIER_SELECT = { select: { id: true, name: true } };
const ITEMS_INCLUDE = {
  items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
};

router.use(authenticate);

async function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: "items (non-empty array) is required" };
  }

  const cleaned = [];
  for (const item of items) {
    const productId = Number(item.productId);
    const quantityOrdered = Number(item.quantityOrdered);
    if (!Number.isInteger(productId)) {
      return { error: "each item requires a valid productId" };
    }
    if (!Number.isInteger(quantityOrdered) || quantityOrdered <= 0) {
      return { error: "each item requires quantityOrdered to be a positive integer" };
    }
    const unitCost =
      item.unitCost !== undefined && item.unitCost !== null && item.unitCost !== ""
        ? Number(item.unitCost)
        : null;
    if (unitCost !== null && Number.isNaN(unitCost)) {
      return { error: "unitCost must be a number" };
    }

    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) {
      return { error: `Product ${productId} not found` };
    }

    cleaned.push({ productId, quantityOrdered, unitCost });
  }

  return { items: cleaned };
}

router.get("/", async (req, res) => {
  const { status, supplierId } = req.query;
  const where = {};
  if (status) where.status = status;
  if (supplierId) where.supplierId = Number(supplierId);

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20));

  const [data, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { supplier: SUPPLIER_SELECT, items: true },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { supplier: SUPPLIER_SELECT, ...ITEMS_INCLUDE },
  });
  if (!order) return res.status(404).json({ error: "Purchase order not found" });
  res.json(order);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { supplierId, notes, items } = req.body || {};
  if (!supplierId) {
    return res.status(400).json({ error: "supplierId is required" });
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: Number(supplierId) } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });

  const validated = await validateItems(items);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const order = await prisma.purchaseOrder.create({
    data: {
      supplierId: Number(supplierId),
      notes: notes || null,
      createdById: req.user.id,
      items: { create: validated.items },
    },
    include: { supplier: SUPPLIER_SELECT, ...ITEMS_INCLUDE },
  });

  await logAction({
    userId: req.user.id,
    action: "create",
    entityType: "purchase_order",
    entityId: order.id,
    details: { supplierId: order.supplierId, itemCount: validated.items.length },
  });

  res.status(201).json(order);
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { supplierId, notes, items } = req.body || {};

  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Purchase order not found" });
  if (existing.status !== "draft") {
    return res.status(400).json({ error: "Only draft purchase orders can be edited" });
  }

  if (supplierId !== undefined) {
    const supplier = await prisma.supplier.findUnique({ where: { id: Number(supplierId) } });
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  }

  let validatedItems;
  if (items !== undefined) {
    const validated = await validateItems(items);
    if (validated.error) return res.status(400).json({ error: validated.error });
    validatedItems = validated.items;
  }

  const order = await prisma.$transaction(async (tx) => {
    if (validatedItems) {
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    }
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(supplierId !== undefined && { supplierId: Number(supplierId) }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(validatedItems && { items: { create: validatedItems } }),
      },
      include: { supplier: SUPPLIER_SELECT, ...ITEMS_INCLUDE },
    });
  });

  await logAction({
    userId: req.user.id,
    action: "update",
    entityType: "purchase_order",
    entityId: id,
    details: {},
  });

  res.json(order);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Purchase order not found" });
  if (existing.status !== "draft") {
    return res.status(400).json({ error: "Only draft purchase orders can be deleted" });
  }

  await prisma.$transaction([
    prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } }),
    prisma.purchaseOrder.delete({ where: { id } }),
  ]);

  await logAction({
    userId: req.user.id,
    action: "delete",
    entityType: "purchase_order",
    entityId: id,
    details: {},
  });

  res.status(204).send();
});

router.post("/:id/mark-ordered", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return res.status(404).json({ error: "Purchase order not found" });
  if (existing.status !== "draft") {
    return res.status(400).json({ error: "Only draft purchase orders can be marked as ordered" });
  }
  if (existing.items.length === 0) {
    return res.status(400).json({ error: "Cannot mark an order with no items as ordered" });
  }

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "ordered", orderedAt: new Date() },
    include: { supplier: SUPPLIER_SELECT, ...ITEMS_INCLUDE },
  });

  await logAction({
    userId: req.user.id,
    action: "mark_ordered",
    entityType: "purchase_order",
    entityId: id,
    details: {},
  });

  res.json(order);
});

router.post("/:id/cancel", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Purchase order not found" });
  if (!["draft", "ordered"].includes(existing.status)) {
    return res.status(400).json({
      error: "Only draft or ordered purchase orders (with nothing received yet) can be cancelled",
    });
  }

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "cancelled", cancelledAt: new Date() },
    include: { supplier: SUPPLIER_SELECT, ...ITEMS_INCLUDE },
  });

  await logAction({
    userId: req.user.id,
    action: "cancel",
    entityType: "purchase_order",
    entityId: id,
    details: {},
  });

  res.json(order);
});

router.post("/:id/receive", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { items, locationId } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items (non-empty array) is required" });
  }

  let resolvedLocationId = null;
  if (locationId !== undefined && locationId !== null && locationId !== "") {
    const location = await prisma.location.findUnique({ where: { id: Number(locationId) } });
    if (!location) return res.status(400).json({ error: "Location not found" });
    resolvedLocationId = location.id;
  }

  const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return res.status(404).json({ error: "Purchase order not found" });
  if (!["ordered", "partially_received"].includes(existing.status)) {
    return res.status(400).json({ error: "Only ordered purchase orders can receive stock" });
  }

  const itemsById = new Map(existing.items.map((item) => [item.id, item]));
  const receipts = [];
  for (const entry of items) {
    const itemId = Number(entry.itemId);
    const quantity = Number(entry.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;

    const line = itemsById.get(itemId);
    if (!line) {
      return res.status(400).json({ error: `Purchase order item ${itemId} not found on this order` });
    }
    if (line.quantityReceived + quantity > line.quantityOrdered) {
      return res.status(400).json({
        error: `Cannot receive ${quantity} for item ${itemId}: exceeds the remaining ordered quantity`,
      });
    }
    receipts.push({ line, quantity });
  }

  if (receipts.length === 0) {
    return res.status(400).json({ error: "No valid receipt quantities were provided" });
  }

  await prisma.$transaction(async (tx) => {
    for (const { line, quantity } of receipts) {
      await tx.stockMovement.create({
        data: {
          productId: line.productId,
          type: "in",
          quantity,
          note: `Received from PO #${id}`,
          locationId: resolvedLocationId,
          createdById: req.user.id,
        },
      });
      await tx.product.update({ where: { id: line.productId }, data: { quantity: { increment: quantity } } });
      await tx.purchaseOrderItem.update({
        where: { id: line.id },
        data: { quantityReceived: { increment: quantity } },
      });
    }
  });

  const refreshedItems = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
  const allReceived = refreshedItems.every((item) => item.quantityReceived >= item.quantityOrdered);
  const anyReceived = refreshedItems.some((item) => item.quantityReceived > 0);

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: allReceived ? "received" : anyReceived ? "partially_received" : existing.status,
      ...(allReceived && { receivedAt: new Date() }),
    },
    include: { supplier: SUPPLIER_SELECT, ...ITEMS_INCLUDE },
  });

  await logAction({
    userId: req.user.id,
    action: "receive",
    entityType: "purchase_order",
    entityId: id,
    details: { receipts: receipts.map(({ line, quantity }) => ({ itemId: line.id, quantity })) },
  });

  res.json(order);
});

module.exports = router;
