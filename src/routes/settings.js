const express = require("express");
const prisma = require("../../prisma/client");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAction } = require("../lib/audit");
const { getShopSettings, SETTINGS_ID } = require("../lib/tax");

const router = express.Router();

router.use(authenticate);

// Readable by any authenticated user: the POS needs the VAT settings to show
// the tax line, and the receipt needs the shop's legal details.
router.get("/shop", async (_req, res) => {
  res.json(await getShopSettings());
});

router.patch("/shop", requireRole("admin"), async (req, res) => {
  const { legalName, taxId, address, vatRegistered, vatRate, pricesIncludeVat } = req.body || {};

  if (vatRate !== undefined && vatRate !== null) {
    const rate = Number(vatRate);
    // A rate is a fraction (0.07), not a percentage (7) — guard against the
    // easy mistake, which would otherwise multiply every receipt by 8.
    if (Number.isNaN(rate) || rate < 0 || rate > 1) {
      return res.status(400).json({ error: "vatRate must be a fraction between 0 and 1 (e.g. 0.07 for 7%)" });
    }
  }
  if (taxId !== undefined && taxId !== null && taxId !== "" && !/^\d{13}$/.test(String(taxId))) {
    return res.status(400).json({ error: "taxId must be 13 digits" });
  }

  const data = {
    ...(legalName !== undefined && { legalName: legalName || null }),
    ...(taxId !== undefined && { taxId: taxId || null }),
    ...(address !== undefined && { address: address || null }),
    ...(vatRegistered !== undefined && { vatRegistered: Boolean(vatRegistered) }),
    ...(vatRate !== undefined && vatRate !== null && { vatRate: Number(vatRate) }),
    ...(pricesIncludeVat !== undefined && { pricesIncludeVat: Boolean(pricesIncludeVat) }),
  };

  const settings = await prisma.shopSetting.upsert({
    where: { id: SETTINGS_ID },
    update: data,
    create: { id: SETTINGS_ID, ...data },
  });

  await logAction({
    userId: req.user.id,
    action: "update",
    entityType: "shop_settings",
    entityId: settings.id,
    details: { vatRegistered: settings.vatRegistered, vatRate: settings.vatRate },
  });

  res.json(settings);
});

module.exports = router;
