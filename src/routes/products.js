const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { toCsv } = require("../lib/csv");

const router = express.Router();

router.use(authenticate);

router.get("/", async (req, res) => {
  const { search } = req.query;
  const where = search
    ? { OR: [{ sku: { contains: search } }, { name: { contains: search } }] }
    : undefined;
  const products = await prisma.product.findMany({ where, orderBy: { name: "asc" } });
  res.json(products);
});

router.get("/export", async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  const csv = toCsv(products, [
    { label: "sku", value: (p) => p.sku },
    { label: "name", value: (p) => p.name },
    { label: "unit", value: (p) => p.unit },
    { label: "quantity", value: (p) => p.quantity },
    { label: "reorderLevel", value: (p) => p.reorderLevel },
  ]);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"products.csv\"");
  res.send(csv);
});

router.get("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) } });
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { sku, name, unit, reorderLevel } = req.body || {};
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
      reorderLevel: reorderLevel ?? 0,
      createdById: req.user.id,
    },
  });
  res.status(201).json(product);
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const { name, unit, reorderLevel, sku } = req.body || {};
  const id = Number(req.params.id);

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(unit !== undefined && { unit }),
      ...(reorderLevel !== undefined && { reorderLevel }),
      ...(sku !== undefined && { sku }),
    },
  });
  res.json(product);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  await prisma.product.delete({ where: { id } });
  res.status(204).send();
});

router.get("/:id/movements", async (req, res) => {
  const productId = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
  });
  res.json(movements);
});

router.get("/:id/movements/export", async (req, res) => {
  const productId = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id: productId } });
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

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  if (type === "out" && product.quantity < quantity) {
    return res.status(400).json({ error: "Insufficient stock for this movement" });
  }

  const delta = type === "in" ? quantity : -quantity;

  const [movement] = await prisma.$transaction([
    prisma.stockMovement.create({
      data: { productId, type, quantity, note, createdById: req.user.id },
    }),
    prisma.product.update({
      where: { id: productId },
      data: { quantity: { increment: delta } },
    }),
  ]);

  res.status(201).json(movement);
});

module.exports = router;
