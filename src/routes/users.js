const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAction } = require("../lib/audit");

const router = express.Router();

const publicUser = ({ id, email, role, homeLocationId, createdAt }) => ({
  id,
  email,
  role,
  homeLocationId,
  createdAt,
});

router.use(authenticate, requireRole("admin"));

async function resolveHomeLocationId(homeLocationId) {
  if (homeLocationId === undefined) return { skip: true };
  if (homeLocationId === null || homeLocationId === "") return { value: null };

  const location = await prisma.location.findUnique({ where: { id: Number(homeLocationId) } });
  if (!location) return { error: "Home location not found" };
  return { value: location.id };
}

router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
  res.json(users.map(publicUser));
});

router.post("/", async (req, res) => {
  const { email, password, role, homeLocationId } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  if (role && !["admin", "staff"].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'staff'" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const resolvedHomeLocation = await resolveHomeLocationId(homeLocationId);
  if (resolvedHomeLocation.error) {
    return res.status(400).json({ error: resolvedHomeLocation.error });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: role || "staff",
      ...(resolvedHomeLocation.skip ? {} : { homeLocationId: resolvedHomeLocation.value }),
    },
  });

  await logAction({
    userId: req.user.id,
    action: "create",
    entityType: "user",
    entityId: user.id,
    details: { email: user.email, role: user.role },
  });

  res.status(201).json(publicUser(user));
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { email, password, role, homeLocationId } = req.body || {};
  if (role && !["admin", "staff"].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'staff'" });
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "User not found" });

  const resolvedHomeLocation = await resolveHomeLocationId(homeLocationId);
  if (resolvedHomeLocation.error) {
    return res.status(400).json({ error: resolvedHomeLocation.error });
  }

  const data = {
    ...(email !== undefined && { email }),
    ...(role !== undefined && { role }),
    ...(resolvedHomeLocation.skip ? {} : { homeLocationId: resolvedHomeLocation.value }),
  };
  if (password) {
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const user = await prisma.user.update({ where: { id }, data });

  await logAction({
    userId: req.user.id,
    action: "update",
    entityType: "user",
    entityId: user.id,
    details: { email: user.email, role: user.role },
  });

  res.json(publicUser(user));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "User not found" });

  // Chat is FK-linked to User (Conversation.userAId/userBId, Message.senderId)
  // and, unlike a movement/audit log row, a DM thread has no "detach and keep
  // going" story — so refuse the delete with a clear 409 rather than letting
  // it fail on the FK constraint, matching the supplier/location pattern.
  const hasConversations = await prisma.conversation.findFirst({
    where: { OR: [{ userAId: id }, { userBId: id }] },
  });
  if (hasConversations) {
    return res.status(409).json({ error: "Cannot delete a user with chat conversations" });
  }
  const hasMessages = await prisma.message.findFirst({ where: { senderId: id } });
  if (hasMessages) {
    return res.status(409).json({ error: "Cannot delete a user with sent messages" });
  }

  await prisma.user.delete({ where: { id } });

  await logAction({
    userId: req.user.id,
    action: "delete",
    entityType: "user",
    entityId: id,
    details: { email: existing.email },
  });

  res.status(204).send();
});

module.exports = router;
