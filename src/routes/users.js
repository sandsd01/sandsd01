const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

const publicUser = ({ id, email, role, createdAt }) => ({ id, email, role, createdAt });

router.use(authenticate, requireRole("admin"));

router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
  res.json(users.map(publicUser));
});

router.post("/", async (req, res) => {
  const { email, password, role } = req.body || {};
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

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, role: role || "staff" },
  });
  res.status(201).json(publicUser(user));
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { email, password, role } = req.body || {};
  if (role && !["admin", "staff"].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'staff'" });
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "User not found" });

  const data = {
    ...(email !== undefined && { email }),
    ...(role !== undefined && { role }),
  };
  if (password) {
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const user = await prisma.user.update({ where: { id }, data });
  res.json(publicUser(user));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "User not found" });

  await prisma.user.delete({ where: { id } });
  res.status(204).send();
});

module.exports = router;
