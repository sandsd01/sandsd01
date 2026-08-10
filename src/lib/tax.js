const prisma = require("../../prisma/client");

// Thai retail almost always advertises VAT-inclusive prices, so that is the
// default: the menu price is what the customer pays, and the VAT portion is
// backed out of it for the receipt. Shops that quote net prices can flip
// pricesIncludeVat and have VAT added on top instead.

const SETTINGS_ID = 1;

const DEFAULT_SETTINGS = {
  id: SETTINGS_ID,
  legalName: null,
  taxId: null,
  address: null,
  vatRegistered: false,
  vatRate: 0.07,
  pricesIncludeVat: true,
};

async function getShopSettings(client = prisma) {
  const existing = await client.shopSetting.findUnique({ where: { id: SETTINGS_ID } });
  return existing || DEFAULT_SETTINGS;
}

function round2(value) {
  // Money is stored as Float, so round at every boundary the customer sees;
  // otherwise 0.1 + 0.2 style drift shows up on receipts and daily totals.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Works out the VAT split for a sale.
 *
 * `subtotal` is the sum of the line totals as priced on the menu.
 * Returns the figures snapshotted onto the Sale row, so a later change to the
 * shop's VAT settings never rewrites the history of past sales.
 */
function calculateTax(subtotal, settings) {
  if (!settings.vatRegistered || !settings.vatRate) {
    return { taxRate: 0, taxAmount: 0, taxInclusive: settings.pricesIncludeVat, total: round2(subtotal) };
  }

  const taxRate = settings.vatRate;

  if (settings.pricesIncludeVat) {
    // The menu price already contains the VAT; extract it rather than adding.
    const net = subtotal / (1 + taxRate);
    return {
      taxRate,
      taxAmount: round2(subtotal - net),
      taxInclusive: true,
      total: round2(subtotal),
    };
  }

  const taxAmount = round2(subtotal * taxRate);
  return { taxRate, taxAmount, taxInclusive: false, total: round2(subtotal + taxAmount) };
}

module.exports = { getShopSettings, calculateTax, round2, SETTINGS_ID, DEFAULT_SETTINGS };
