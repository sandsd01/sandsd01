const prisma = require("../../prisma/client");
const { toDecimal, money } = require("./money");

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

// Kept for callers that just need a rounded Decimal; the exactness now comes
// from Decimal arithmetic rather than from rounding away float drift.
function round2(value) {
  return money(value);
}

/**
 * Works out the VAT split for a sale.
 *
 * `subtotal` is the sum of the line totals as priced on the menu.
 * Returns the figures snapshotted onto the Sale row, so a later change to the
 * shop's VAT settings never rewrites the history of past sales.
 */
function calculateTax(subtotal, settings) {
  const gross = toDecimal(subtotal);
  const rate = toDecimal(settings.vatRate);

  if (!settings.vatRegistered || rate.isZero()) {
    return {
      taxRate: toDecimal(0),
      taxAmount: toDecimal(0),
      taxInclusive: Boolean(settings.pricesIncludeVat),
      total: money(gross),
    };
  }

  if (settings.pricesIncludeVat) {
    // The menu price already contains the VAT; extract it rather than adding,
    // so turning VAT on never changes what the customer is charged.
    const net = gross.dividedBy(rate.plus(1));
    return {
      taxRate: rate,
      taxAmount: money(gross.minus(net)),
      taxInclusive: true,
      total: money(gross),
    };
  }

  const taxAmount = money(gross.times(rate));
  return { taxRate: rate, taxAmount, taxInclusive: false, total: money(gross.plus(taxAmount)) };
}

module.exports = { getShopSettings, calculateTax, round2, SETTINGS_ID, DEFAULT_SETTINGS };
