const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAction } = require("../lib/audit");
const { applyStockMovement, InsufficientStockError } = require("../lib/stock");
const { generateReceiptPdf } = require("../lib/pdf");

const router = express.Router();

const SALE_INCLUDE = {
  location: { select: { id: true, name: true } },
  cashier: { select: { id: true, email: true } },
  voidedBy: { select: { id: true, email: true } },
  items: { include: { modifiers: true } },
};

router.use(authenticate);

// Staff are always scoped to their own home location (if they have one); admins can
// see/filter across all locations. Returns null when no forced scope applies.
async function getStaffHomeLocationId(req) {
  if (req.user.role !== "staff") return null;
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { homeLocationId: true },
  });
  return user?.homeLocationId ?? null;
}

router.post("/", requireRole("admin", "staff"), async (req, res) => {
  const { locationId, items, paymentMethod, amountTendered, note } = req.body || {};

  if (locationId === undefined || locationId === null || locationId === "") {
    return res.status(400).json({ error: "locationId is required" });
  }
  const location = await prisma.location.findUnique({ where: { id: Number(locationId) } });
  if (!location || !location.isActive) {
    return res.status(400).json({ error: "locationId must refer to an existing, active location" });
  }

  if (!["cash", "promptpay", "card"].includes(paymentMethod)) {
    return res.status(400).json({ error: "paymentMethod must be 'cash', 'promptpay', or 'card'" });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items (non-empty array) is required" });
  }

  const preparedItems = [];
  for (const item of items) {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(productId)) {
      return res.status(400).json({ error: "each item requires a valid productId" });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "each item requires quantity to be a positive integer" });
    }

    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) {
      return res.status(400).json({ error: `Product ${productId} not found` });
    }

    const modifierOptionIds = Array.isArray(item.modifierOptionIds)
      ? item.modifierOptionIds.map(Number)
      : [];

    let options = [];
    if (modifierOptionIds.length > 0) {
      options = await prisma.modifierOption.findMany({
        where: { id: { in: modifierOptionIds } },
        include: { modifierGroup: true },
      });
      if (options.length !== modifierOptionIds.length) {
        return res
          .status(400)
          .json({ error: `One or more modifier options were not found for product ${productId}` });
      }
      const invalid = options.find((o) => o.modifierGroup.productId !== productId);
      if (invalid) {
        return res
          .status(400)
          .json({ error: `Modifier option ${invalid.id} does not belong to product ${productId}` });
      }
    }

    const modifierTotal = options.reduce((sum, o) => sum + o.priceDelta, 0);
    const unitPrice = (product.sellingPrice ?? 0) + modifierTotal;
    const lineTotal = unitPrice * quantity;

    preparedItems.push({ product, quantity, options, unitPrice, lineTotal });
  }

  const subtotal = preparedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const total = subtotal;

  let resolvedAmountTendered = null;
  let changeDue = null;
  if (
    paymentMethod === "cash" &&
    amountTendered !== undefined &&
    amountTendered !== null &&
    amountTendered !== ""
  ) {
    const tendered = Number(amountTendered);
    if (Number.isNaN(tendered) || tendered < total) {
      return res
        .status(400)
        .json({ error: "amountTendered must be a number greater than or equal to the total" });
    }
    resolvedAmountTendered = tendered;
    changeDue = tendered - total;
  }

  const stockResults = [];
  let sale;
  try {
    sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          locationId: location.id,
          cashierId: req.user.id,
          subtotal,
          total,
          paymentMethod,
          amountTendered: resolvedAmountTendered,
          changeDue,
          note: note || null,
        },
      });

      for (const item of preparedItems) {
        const saleItem = await tx.saleItem.create({
          data: {
            saleId: created.id,
            productId: item.product.id,
            productName: item.product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          },
        });

        for (const option of item.options) {
          await tx.saleItemModifier.create({
            data: {
              saleItemId: saleItem.id,
              modifierOptionId: option.id,
              name: option.name,
              priceDelta: option.priceDelta,
            },
          });
        }

        const { updatedProduct, previousQuantity } = await applyStockMovement(tx, {
          productId: item.product.id,
          locationId: location.id,
          type: "out",
          quantity: item.quantity,
          note: `POS sale #${created.id}`,
          createdById: req.user.id,
        });
        stockResults.push({ updatedProduct, previousQuantity });
      }

      return created;
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  await logAction({
    userId: req.user.id,
    action: "sale_create",
    entityType: "sale",
    entityId: sale.id,
    details: { locationId: location.id, total: sale.total, itemCount: preparedItems.length },
  });

  for (const { updatedProduct, previousQuantity } of stockResults) {
    req.app.locals.onStockMovement?.(updatedProduct, previousQuantity);
  }

  const fullSale = await prisma.sale.findUnique({ where: { id: sale.id }, include: SALE_INCLUDE });
  res.status(201).json(fullSale);
});

router.get("/", requireRole("admin", "staff"), async (req, res) => {
  const { locationId, from, to, status } = req.query;
  const where = {};
  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  if (locationId) where.locationId = Number(locationId);

  const staffHomeLocationId = await getStaffHomeLocationId(req);
  if (staffHomeLocationId) {
    where.locationId = staffHomeLocationId;
  }

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20));

  const [data, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: SALE_INCLUDE,
    }),
    prisma.sale.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const sale = await prisma.sale.findUnique({ where: { id }, include: SALE_INCLUDE });
  if (!sale) return res.status(404).json({ error: "Sale not found" });

  const staffHomeLocationId = await getStaffHomeLocationId(req);
  if (staffHomeLocationId && sale.locationId !== staffHomeLocationId) {
    return res.status(404).json({ error: "Sale not found" });
  }

  res.json(sale);
});

router.get("/:id/receipt", async (req, res) => {
  const id = Number(req.params.id);
  const sale = await prisma.sale.findUnique({ where: { id }, include: SALE_INCLUDE });
  if (!sale) return res.status(404).json({ error: "Sale not found" });

  const staffHomeLocationId = await getStaffHomeLocationId(req);
  if (staffHomeLocationId && sale.locationId !== staffHomeLocationId) {
    return res.status(404).json({ error: "Sale not found" });
  }

  const pdf = await generateReceiptPdf(sale);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="receipt-${sale.id}.pdf"`);
  res.send(pdf);
});

router.post("/:id/void", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};
  if (!reason) {
    return res.status(400).json({ error: "reason is required" });
  }

  const sale = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  if (sale.status === "voided") {
    return res.status(400).json({ error: "Sale is already voided" });
  }

  const stockResults = [];
  try {
    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        const { updatedProduct, previousQuantity } = await applyStockMovement(tx, {
          productId: item.productId,
          locationId: sale.locationId,
          type: "in",
          quantity: item.quantity,
          note: `Void of sale #${sale.id}: ${reason}`,
          createdById: req.user.id,
        });
        stockResults.push({ updatedProduct, previousQuantity });
      }

      await tx.sale.update({
        where: { id },
        data: { status: "voided", voidedAt: new Date(), voidedById: req.user.id },
      });
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  await logAction({
    userId: req.user.id,
    action: "sale_void",
    entityType: "sale",
    entityId: id,
    details: { reason },
  });

  for (const { updatedProduct, previousQuantity } of stockResults) {
    req.app.locals.onStockMovement?.(updatedProduct, previousQuantity);
  }

  const fullSale = await prisma.sale.findUnique({ where: { id }, include: SALE_INCLUDE });
  res.json(fullSale);
});

module.exports = router;
