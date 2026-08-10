const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAction } = require("../lib/audit");
const { upload } = require("../lib/upload");
const { saveUpload, deleteUpload } = require("../lib/storage");

const router = express.Router();

router.use(authenticate);

router.get("/", async (_req, res) => {
  const locations = await prisma.location.findMany({ orderBy: { name: "asc" } });
  res.json(locations);
});

router.get("/:id/stock", async (req, res) => {
  const locationId = Number(req.params.id);
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) return res.status(404).json({ error: "Location not found" });

  const stock = await prisma.locationStock.findMany({
    where: { locationId, product: { deletedAt: null } },
    include: { product: { select: { id: true, sku: true, name: true, sellingPrice: true } } },
    orderBy: { product: { name: "asc" } },
  });

  res.json(
    stock.map((s) => ({
      productId: s.productId,
      quantity: s.quantity,
      updatedAt: s.updatedAt,
      product: s.product,
    }))
  );
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { name, address, phone, isActive, taxBranchCode } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const existing = await prisma.location.findUnique({ where: { name } });
  if (existing) {
    return res.status(409).json({ error: "A location with this name already exists" });
  }

  const location = await prisma.location.create({
    data: {
      name,
      address: address || null,
      phone: phone || null,
      taxBranchCode: taxBranchCode || null,
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    },
  });

  await logAction({
    userId: req.user.id,
    action: "create",
    entityType: "location",
    entityId: location.id,
    details: { name: location.name },
  });

  res.status(201).json(location);
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, address, phone, isActive, taxBranchCode } = req.body || {};

  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Location not found" });

  const location = await prisma.location.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(address !== undefined && { address: address || null }),
      ...(phone !== undefined && { phone: phone || null }),
      ...(taxBranchCode !== undefined && { taxBranchCode: taxBranchCode || null }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    },
  });

  await logAction({
    userId: req.user.id,
    action: "update",
    entityType: "location",
    entityId: location.id,
    details: { name: location.name },
  });

  res.json(location);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Location not found" });

  const hasMovements = await prisma.stockMovement.findFirst({ where: { locationId: id } });
  if (hasMovements) {
    return res.status(409).json({ error: "Cannot delete a location with recorded movements" });
  }

  const hasStock = await prisma.locationStock.findFirst({ where: { locationId: id, quantity: { gt: 0 } } });
  if (hasStock) {
    return res.status(409).json({ error: "Cannot delete a location with remaining stock" });
  }

  await prisma.location.delete({ where: { id } });

  await logAction({
    userId: req.user.id,
    action: "delete",
    entityType: "location",
    entityId: id,
    details: { name: existing.name },
  });

  res.status(204).send();
});

router.post(
  "/:id/promptpay-qr",
  requireRole("admin"),
  (req, res, next) => {
    upload.single("qr")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.location.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Location not found" });
    if (!req.file) return res.status(400).json({ error: "qr file is required" });

    const promptPayQrUrl = await saveUpload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      prefix: `location-${id}-qr`,
    });
    await deleteUpload(existing.promptPayQrUrl);

    const location = await prisma.location.update({ where: { id }, data: { promptPayQrUrl } });

    await logAction({
      userId: req.user.id,
      action: "location_promptpay_qr_upload",
      entityType: "location",
      entityId: location.id,
      details: { name: location.name },
    });

    res.json(location);
  }
);

router.delete("/:id/promptpay-qr", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Location not found" });
  if (!existing.promptPayQrUrl) {
    return res.status(400).json({ error: "Location has no PromptPay QR to delete" });
  }

  await deleteUpload(existing.promptPayQrUrl);

  const location = await prisma.location.update({ where: { id }, data: { promptPayQrUrl: null } });

  await logAction({
    userId: req.user.id,
    action: "location_promptpay_qr_delete",
    entityType: "location",
    entityId: location.id,
    details: { name: location.name },
  });

  res.json(location);
});

module.exports = router;
