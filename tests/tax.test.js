const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser, prisma } = require("./helpers/db");
const app = require("../src/app");
const { calculateTax } = require("../src/lib/tax");
const { isDecimal, toNumber } = require("../src/lib/money");

async function login(email, password) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token;
}

describe("VAT calculation", () => {
  // calculateTax works in Prisma.Decimal so the arithmetic is exact; the API
  // converts to numbers at the response boundary. These tests call it directly,
  // so they compare numerically and assert the Decimal contract explicitly.
  test("returns Decimals, not floats", () => {
    const r = calculateTax(107, { vatRegistered: true, vatRate: 0.07, pricesIncludeVat: true });
    assert.ok(isDecimal(r.total), "total must be a Decimal");
    assert.ok(isDecimal(r.taxAmount), "taxAmount must be a Decimal");
    assert.ok(isDecimal(r.taxRate), "taxRate must be a Decimal");
  });

  test("no VAT when the shop isn't VAT-registered", () => {
    const r = calculateTax(100, { vatRegistered: false, vatRate: 0.07, pricesIncludeVat: true });
    assert.equal(toNumber(r.taxAmount), 0);
    assert.equal(toNumber(r.taxRate), 0);
    assert.equal(toNumber(r.total), 100);
  });

  test("inclusive pricing backs VAT out of the menu price", () => {
    // 107 gross at 7% => 100 net + 7 VAT; the customer still pays 107.
    const r = calculateTax(107, { vatRegistered: true, vatRate: 0.07, pricesIncludeVat: true });
    assert.equal(toNumber(r.total), 107);
    assert.equal(toNumber(r.taxAmount), 7);
    assert.equal(r.taxInclusive, true);
  });

  test("exclusive pricing adds VAT on top", () => {
    const r = calculateTax(100, { vatRegistered: true, vatRate: 0.07, pricesIncludeVat: false });
    assert.equal(toNumber(r.taxAmount), 7);
    assert.equal(toNumber(r.total), 107);
    assert.equal(r.taxInclusive, false);
  });

  test("rounds to two decimals rather than leaking float drift", () => {
    const r = calculateTax(79, { vatRegistered: true, vatRate: 0.07, pricesIncludeVat: true });
    // 79 - 79/1.07 = 5.1682...
    assert.equal(toNumber(r.taxAmount), 5.17);
    assert.equal(toNumber(r.total), 79);
    assert.equal(Number.isInteger(toNumber(r.taxAmount) * 100), true);
  });

  test("summing many lines stays exact where floats would drift", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; Decimal must not have that
    // problem, which is the whole reason for this migration.
    const drifty = calculateTax(0.1, { vatRegistered: false, vatRate: 0, pricesIncludeVat: true });
    const sum = drifty.total.plus(0.2);
    assert.equal(sum.toString(), "0.3");
  });
});

describe("Shop settings API", () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("returns usable defaults before anything is configured", async () => {
    const res = await request(app)
      .get("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.vatRegistered, false);
    assert.equal(res.body.vatRate, 0.07);
    assert.equal(res.body.pricesIncludeVat, true);
  });

  test("admin can configure the shop; staff can read but not write", async () => {
    const update = await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ legalName: "Burger Co Ltd", taxId: "1234567890123", vatRegistered: true });
    assert.equal(update.status, 200);
    assert.equal(update.body.legalName, "Burger Co Ltd");
    assert.equal(update.body.vatRegistered, true);

    const staffRead = await request(app)
      .get("/api/settings/shop")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(staffRead.status, 200);
    assert.equal(staffRead.body.taxId, "1234567890123");

    const staffWrite = await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ vatRegistered: false });
    assert.equal(staffWrite.status, 403);
  });

  test("rejects a percentage passed where a fraction is expected", async () => {
    const res = await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vatRate: 7 });
    assert.equal(res.status, 400);
  });

  test("rejects a malformed tax id", async () => {
    const res = await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ taxId: "123" });
    assert.equal(res.status, 400);
  });
});

describe("Sales carry VAT and a receipt number", () => {
  let adminToken;
  let productId;
  let locationId;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    adminToken = await login("admin@test.com", "adminpass1");

    const product = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-VAT", name: "Burger", unit: "pcs", sellingPrice: 107 });
    productId = product.body.id;

    const location = await request(app)
      .post("/api/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "VAT Branch", taxBranchCode: "00000" });
    locationId = location.body.id;

    await request(app)
      .post(`/api/products/${productId}/movements`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "in", quantity: 20, locationId });
  });

  async function sell() {
    return request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        locationId,
        items: [{ productId, quantity: 1 }],
        paymentMethod: "cash",
      });
  }

  test("records zero VAT while the shop isn't registered", async () => {
    const res = await sell();
    assert.equal(res.status, 201);
    assert.equal(res.body.taxAmount, 0);
    assert.equal(res.body.total, 107);
  });

  test("splits VAT out of an inclusive price without changing what the customer pays", async () => {
    await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vatRegistered: true, pricesIncludeVat: true });

    const res = await sell();
    assert.equal(res.status, 201);
    assert.equal(res.body.total, 107, "an inclusive price must not change the amount charged");
    assert.equal(res.body.taxAmount, 7);
    assert.equal(res.body.taxInclusive, true);
    assert.equal(res.body.taxRate, 0.07);
  });

  test("adds VAT on top when prices are quoted net", async () => {
    await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vatRegistered: true, pricesIncludeVat: false });

    const res = await sell();
    assert.equal(res.status, 201);
    assert.equal(res.body.subtotal, 107);
    assert.equal(res.body.taxAmount, 7.49);
    assert.equal(res.body.total, 114.49);
  });

  test("cash tendered is validated against the VAT-inclusive total", async () => {
    await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vatRegistered: true, pricesIncludeVat: false });

    // 107 covers the subtotal but not the 114.49 actually owed once VAT is added.
    const short = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        locationId,
        items: [{ productId, quantity: 1 }],
        paymentMethod: "cash",
        amountTendered: 107,
      });
    assert.equal(short.status, 400);
  });

  test("assigns a unique receipt number to every sale", async () => {
    const first = await sell();
    const second = await sell();
    assert.match(first.body.receiptNumber, /^\d{6}-\d{6}$/);
    assert.notEqual(first.body.receiptNumber, second.body.receiptNumber);
  });

  test("the receipt PDF still renders once VAT is configured", async () => {
    await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vatRegistered: true, taxId: "1234567890123", legalName: "Burger Co" });

    const sale = await sell();
    const res = await request(app)
      .get(`/api/sales/${sale.body.id}/receipt`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/pdf/);
    assert.equal(res.body.subarray(0, 4).toString(), "%PDF");
  });

  test("changing VAT settings later does not rewrite past sales", async () => {
    const before = await sell();
    assert.equal(before.body.taxAmount, 0);

    await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vatRegistered: true });

    const fetched = await request(app)
      .get(`/api/sales/${before.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(fetched.body.taxAmount, 0, "the historical sale must keep its own VAT snapshot");
    assert.equal(fetched.body.total, 107);
  });

  test("prisma stores the shop settings as a single row", async () => {
    await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ legalName: "One" });
    await request(app)
      .patch("/api/settings/shop")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ legalName: "Two" });

    const rows = await prisma.shopSetting.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].legalName, "Two");
  });
});
