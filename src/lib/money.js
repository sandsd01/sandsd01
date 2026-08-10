const { Prisma } = require("@prisma/client");

// Money is stored as Postgres NUMERIC and surfaces in JS as Prisma.Decimal, so
// that adding up a bill is exact rather than accumulating binary-float error.
// Decimal objects are awkward everywhere else though — they JSON-serialise as
// strings, and the SPA does arithmetic and .toFixed() on these values — so the
// API converts them back to numbers on the way out (see decimalsToNumbers).
// THB amounts in a POS are nowhere near Number's exact-integer range, so the
// boundary conversion is lossless in practice; the exactness that matters is
// in the storage and the arithmetic.

const Decimal = Prisma.Decimal;

function toDecimal(value) {
  return value instanceof Decimal ? value : new Decimal(value ?? 0);
}

/** Rounds to 2dp, half-up — the rounding a customer expects on a receipt. */
function money(value) {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function toNumber(value) {
  if (value === null || value === undefined) return value;
  return toDecimal(value).toNumber();
}

function isDecimal(value) {
  return value instanceof Decimal || Decimal.isDecimal(value);
}

/**
 * Deep-converts Prisma.Decimal values to plain numbers. Applied once to every
 * response body rather than per-route, so a new route can't forget it and
 * accidentally start returning `"79"` where clients expect `79`.
 */
function decimalsToNumbers(value) {
  if (isDecimal(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(decimalsToNumbers);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = decimalsToNumbers(item);
    return out;
  }
  return value;
}

module.exports = { Decimal, toDecimal, money, toNumber, isDecimal, decimalsToNumbers };
