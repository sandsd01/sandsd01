const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAction } = require("../lib/audit");

const router = express.Router();

router.use(authenticate);

router.get("/", async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  res.json(suppliers);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { name, contactEmail, contactPhone } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const existing = await prisma.supplier.findUnique({ where: { name } });
  if (existing) {
    return res.status(409).json({ error: "A supplier with this name already exists" });
  }

  const supplier = await prisma.supplier.create({
    data: { name, contactEmail: contactEmail || null, contactPhone: contactPhone || null },
  });

  await logAction({
    userId: req.user.id,
    action: "create",
    entityType: "supplier",
    entityId: supplier.id,
    details: { name: supplier.name },
  });

  res.status(201).json(supplier);
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, contactEmail, contactPhone } = req.body || {};

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Supplier not found" });

  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(contactEmail !== undefined && { contactEmail: contactEmail || null }),
      ...(contactPhone !== undefined && { contactPhone: contactPhone || null }),
    },
  });

  await logAction({
    userId: req.user.id,
    action: "update",
    entityType: "supplier",
    entityId: supplier.id,
    details: { name: supplier.name },
  });

  res.json(supplier);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Supplier not found" });

  await prisma.product.updateMany({ where: { supplierId: id }, data: { supplierId: null } });
  await prisma.supplier.delete({ where: { id } });

  await logAction({
    userId: req.user.id,
    action: "delete",
    entityType: "supplier",
    entityId: id,
    details: { name: existing.name },
  });

  res.status(204).send();
});

module.exports = router;
