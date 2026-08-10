// Shared helper for applying a stock movement (create the movement row, update the
// company-wide Product.quantity, and — when a locationId is given — keep the branch's
// LocationStock partition in sync). Must be called with a Prisma transaction client
// (i.e. from inside `prisma.$transaction(async (tx) => { ... })`) so the movement,
// product update, and location-stock upsert are all-or-nothing.

class InsufficientStockError extends Error {
  constructor(message) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

async function applyStockMovement(tx, { productId, locationId, type, quantity, note, createdById }) {
  if (!["in", "out"].includes(type)) {
    throw new Error("type must be 'in' or 'out'");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }

  const resolvedLocationId = locationId ?? null;
  const delta = type === "in" ? quantity : -quantity;

  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }
  const previousQuantity = product.quantity;

  if (type === "out" && previousQuantity < quantity) {
    throw new InsufficientStockError(`Insufficient stock for product ${productId}`);
  }

  if (resolvedLocationId) {
    const locationStock = await tx.locationStock.findUnique({
      where: { productId_locationId: { productId, locationId: resolvedLocationId } },
    });
    const currentLocationQty = locationStock?.quantity ?? 0;
    if (type === "out" && currentLocationQty < quantity) {
      throw new InsufficientStockError(
        `Insufficient stock at location ${resolvedLocationId} for product ${productId}`
      );
    }
  }

  const movement = await tx.stockMovement.create({
    data: { productId, type, quantity, note, locationId: resolvedLocationId, createdById },
  });

  const updatedProduct = await tx.product.update({
    where: { id: productId },
    data: { quantity: { increment: delta } },
  });

  if (resolvedLocationId) {
    await tx.locationStock.upsert({
      where: { productId_locationId: { productId, locationId: resolvedLocationId } },
      create: { productId, locationId: resolvedLocationId, quantity: delta },
      update: { quantity: { increment: delta } },
    });
  }

  return { movement, updatedProduct, previousQuantity };
}

module.exports = { applyStockMovement, InsufficientStockError };
