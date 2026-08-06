const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAction } = require("../lib/audit");

const router = express.Router();

router.use(authenticate);

router.get("/", async (_req, res) => {
  const locations = await prisma.location.findMany({ orderBy: { name: "asc" } });
  res.json(locations);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { name } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const existing = await prisma.location.findUnique({ where: { name } });
  if (existing) {
    return res.status(409).json({ error: "A location with this name already exists" });
  }

  const location = await prisma.location.create({ data: { name } });

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
  const { name } = req.body || {};

  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Location not found" });

  const location = await prisma.location.update({
    where: { id },
    data: { ...(name !== undefined && { name }) },
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

module.exports = router;
