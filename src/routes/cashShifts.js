const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAction } = require("../lib/audit");
const { toDecimal, money } = require("../lib/money");

const router = express.Router();

router.use(authenticate);

const SHIFT_INCLUDE = {
  location: { select: { id: true, name: true } },
  openedBy: { select: { id: true, email: true } },
  closedBy: { select: { id: true, email: true } },
};

// Staff are pinned to their own branch here for the same reason as /sales:
// otherwise a cashier could open or close the drawer of a branch they don't
// work at, and the variance would land on the wrong shift.
async function staffHomeLocationId(req) {
  if (req.user.role !== "staff") return null;
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { homeLocationId: true },
  });
  return user?.homeLocationId ?? null;
}

/** Cash actually taken during the shift — card and PromptPay never hit the drawer. */
async function cashTakenDuringShift(shiftId) {
  const sales = await prisma.sale.findMany({
    where: { cashShiftId: shiftId, status: "completed", paymentMethod: "cash" },
    select: { total: true },
  });
  return money(sales.reduce((sum, s) => sum.plus(toDecimal(s.total)), toDecimal(0)));
}

async function summarise(shift) {
  const cashSales = await cashTakenDuringShift(shift.id);
  const expectedCash = money(toDecimal(shift.openingFloat).plus(cashSales));
  const saleCount = await prisma.sale.count({
    where: { cashShiftId: shift.id, status: "completed" },
  });
  return { ...shift, cashSales, expectedCash, saleCount };
}

/**
 * Adds cashSales/expectedCash/saleCount to a page of shifts using two grouped
 * queries rather than a pair per row, so the history table doesn't turn into
 * an N+1 as it fills up.
 */
async function summariseMany(shifts) {
  if (shifts.length === 0) return [];
  const ids = shifts.map((s) => s.id);

  const [cashByShift, countByShift] = await Promise.all([
    prisma.sale.groupBy({
      by: ["cashShiftId"],
      where: { cashShiftId: { in: ids }, status: "completed", paymentMethod: "cash" },
      _sum: { total: true },
    }),
    prisma.sale.groupBy({
      by: ["cashShiftId"],
      where: { cashShiftId: { in: ids }, status: "completed" },
      _count: { _all: true },
    }),
  ]);

  const cash = new Map(cashByShift.map((r) => [r.cashShiftId, r._sum.total]));
  const counts = new Map(countByShift.map((r) => [r.cashShiftId, r._count._all]));

  return shifts.map((shift) => {
    const cashSales = money(toDecimal(cash.get(shift.id) ?? 0));
    return {
      ...shift,
      cashSales,
      expectedCash: money(toDecimal(shift.openingFloat).plus(cashSales)),
      saleCount: counts.get(shift.id) ?? 0,
    };
  });
}

/** The open shift for a branch, or null. At most one may be open per branch. */
async function findOpenShift(locationId) {
  return prisma.cashShift.findFirst({
    where: { locationId, status: "open" },
    include: SHIFT_INCLUDE,
  });
}

router.get("/current", async (req, res) => {
  const scoped = await staffHomeLocationId(req);
  const locationId = scoped ?? Number(req.query.locationId);
  if (!locationId) {
    return res.status(400).json({ error: "locationId is required" });
  }

  const shift = await findOpenShift(locationId);
  if (!shift) return res.json(null);
  res.json(await summarise(shift));
});

router.get("/", async (req, res) => {
  const scoped = await staffHomeLocationId(req);
  const where = {};
  if (scoped) where.locationId = scoped;
  else if (req.query.locationId) where.locationId = Number(req.query.locationId);
  if (req.query.status) where.status = req.query.status;

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20));

  const [data, total] = await Promise.all([
    prisma.cashShift.findMany({
      where,
      include: SHIFT_INCLUDE,
      orderBy: { openedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.cashShift.count({ where }),
  ]);

  res.json({ data: await summariseMany(data), total, page, pageSize });
});

router.post("/open", requireRole("admin", "staff"), async (req, res) => {
  const { locationId, openingFloat, note } = req.body || {};

  const scoped = await staffHomeLocationId(req);
  const targetLocationId = scoped ?? Number(locationId);
  if (!targetLocationId) {
    return res.status(400).json({ error: "locationId is required" });
  }
  if (scoped && locationId !== undefined && Number(locationId) !== scoped) {
    return res.status(403).json({ error: "You can only open a shift at your own branch" });
  }

  const location = await prisma.location.findUnique({ where: { id: targetLocationId } });
  if (!location || !location.isActive) {
    return res.status(400).json({ error: "locationId must refer to an existing, active location" });
  }

  const float = Number(openingFloat);
  if (openingFloat === undefined || Number.isNaN(float) || float < 0) {
    return res.status(400).json({ error: "openingFloat must be a number greater than or equal to 0" });
  }

  // Two open shifts on one drawer would split the day's cash across both and
  // make neither variance meaningful.
  const existing = await findOpenShift(targetLocationId);
  if (existing) {
    return res.status(409).json({ error: "This branch already has an open shift" });
  }

  const shift = await prisma.cashShift.create({
    data: {
      locationId: targetLocationId,
      openedById: req.user.id,
      openingFloat: money(float),
      openingNote: note || null,
    },
    include: SHIFT_INCLUDE,
  });

  await logAction({
    userId: req.user.id,
    action: "shift_open",
    entityType: "cash_shift",
    entityId: shift.id,
    details: { locationId: targetLocationId, openingFloat: Number(float) },
  });

  res.status(201).json(await summarise(shift));
});

router.post("/:id/close", requireRole("admin", "staff"), async (req, res) => {
  const id = Number(req.params.id);
  const { countedCash, note } = req.body || {};

  const shift = await prisma.cashShift.findUnique({ where: { id }, include: SHIFT_INCLUDE });
  if (!shift) return res.status(404).json({ error: "Shift not found" });

  const scoped = await staffHomeLocationId(req);
  if (scoped && shift.locationId !== scoped) {
    return res.status(403).json({ error: "You can only close a shift at your own branch" });
  }
  if (shift.status === "closed") {
    return res.status(400).json({ error: "Shift is already closed" });
  }

  const counted = Number(countedCash);
  if (countedCash === undefined || Number.isNaN(counted) || counted < 0) {
    return res.status(400).json({ error: "countedCash must be a number greater than or equal to 0" });
  }

  const cashSales = await cashTakenDuringShift(shift.id);
  const expectedCash = money(toDecimal(shift.openingFloat).plus(cashSales));
  const variance = money(toDecimal(counted).minus(expectedCash));

  const closed = await prisma.cashShift.update({
    where: { id },
    data: {
      status: "closed",
      closedById: req.user.id,
      closedAt: new Date(),
      countedCash: money(counted),
      variance,
      closingNote: note || null,
    },
    include: SHIFT_INCLUDE,
  });

  await logAction({
    userId: req.user.id,
    action: "shift_close",
    entityType: "cash_shift",
    entityId: closed.id,
    details: {
      locationId: closed.locationId,
      expectedCash: Number(expectedCash),
      countedCash: counted,
      variance: Number(variance),
    },
  });

  res.json(await summarise(closed));
});

module.exports = { router, findOpenShift };
