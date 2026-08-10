const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser, prisma } = require("./helpers/db");
const app = require("../src/app");

async function login(email, password) {
  const res = await request(app).post("/auth/login").send({ email, password });
  return res.body.token;
}

async function createProduct(token, overrides = {}) {
  return request(app)
    .post("/products")
    .set("Authorization", `Bearer ${token}`)
    .send({ sku: "SKU-1", name: "Widget", unit: "pcs", ...overrides });
}

async function createLocation(token, overrides = {}) {
  return request(app)
    .post("/locations")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Branch", ...overrides });
}

async function stockIn(token, productId, quantity, locationId) {
  return request(app)
    .post(`/products/${productId}/movements`)
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "in", quantity, locationId });
}

describe("Sales API", () => {
  let adminToken;
  let staffToken;
  let staffUser;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    staffUser = await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("requires authentication to create a sale", async () => {
    const res = await request(app).post("/sales").send({});
    assert.equal(res.status, 401);
  });

  test("staff can create a sale, decrementing both branch and company-wide stock", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-1", sellingPrice: 100 });
    const location = await createLocation(adminToken, { name: "Branch A" });
    await stockIn(adminToken, product.body.id, 10, location.body.id);

    const res = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: product.body.id, quantity: 3 }],
        paymentMethod: "card",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.total, 300);
    assert.equal(res.body.subtotal, 300);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].quantity, 3);
    assert.equal(res.body.items[0].unitPrice, 100);
    assert.equal(res.body.items[0].lineTotal, 300);

    const locationStock = await prisma.locationStock.findUnique({
      where: { productId_locationId: { productId: product.body.id, locationId: location.body.id } },
    });
    assert.equal(locationStock.quantity, 7);

    const updatedProduct = await prisma.product.findUnique({ where: { id: product.body.id } });
    assert.equal(updatedProduct.quantity, 7);

    const sales = await prisma.sale.findMany({ where: { id: res.body.id } });
    assert.equal(sales.length, 1);
    const saleItems = await prisma.saleItem.findMany({ where: { saleId: res.body.id } });
    assert.equal(saleItems.length, 1);
    assert.equal(saleItems[0].productId, product.body.id);
  });

  test("franchise invariant: stock at branch A only cannot be sold from branch B, even though company-wide quantity would cover it", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-2", sellingPrice: 50 });
    const branchA = await createLocation(adminToken, { name: "Branch A2" });
    const branchB = await createLocation(adminToken, { name: "Branch B2" });

    await stockIn(adminToken, product.body.id, 5, branchA.body.id);

    const res = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: branchB.body.id,
        items: [{ productId: product.body.id, quantity: 3 }],
        paymentMethod: "cash",
        amountTendered: 150,
      });
    assert.equal(res.status, 400);

    const updatedProduct = await prisma.product.findUnique({ where: { id: product.body.id } });
    assert.equal(updatedProduct.quantity, 5, "company-wide quantity must be unchanged");

    const stockA = await prisma.locationStock.findUnique({
      where: { productId_locationId: { productId: product.body.id, locationId: branchA.body.id } },
    });
    assert.equal(stockA.quantity, 5, "branch A stock must be unchanged");

    const stockB = await prisma.locationStock.findUnique({
      where: { productId_locationId: { productId: product.body.id, locationId: branchB.body.id } },
    });
    assert.ok(!stockB || stockB.quantity === 0, "branch B must have no stock");

    const sales = await prisma.sale.findMany();
    assert.equal(sales.length, 0, "no sale row should have been created");
  });

  test("sums modifier price deltas into unitPrice and lineTotal", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-3", sellingPrice: 80 });
    const location = await createLocation(adminToken, { name: "Branch C" });
    await stockIn(adminToken, product.body.id, 10, location.body.id);

    const group = await request(app)
      .post(`/products/${product.body.id}/modifier-groups`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Size", selectionType: "single" });
    assert.equal(group.status, 201);

    const option = await request(app)
      .post(`/products/modifier-groups/${group.body.id}/options`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Large", priceDelta: 20 });
    assert.equal(option.status, 201);

    const res = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: product.body.id, quantity: 2, modifierOptionIds: [option.body.id] }],
        paymentMethod: "card",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.items[0].unitPrice, 100);
    assert.equal(res.body.items[0].lineTotal, 200);
    assert.equal(res.body.total, 200);
    assert.equal(res.body.items[0].modifiers.length, 1);
    assert.equal(res.body.items[0].modifiers[0].name, "Large");
    assert.equal(res.body.items[0].modifiers[0].priceDelta, 20);
  });

  test("admin voiding a sale restores stock and sets status to voided; a second void is rejected", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-4", sellingPrice: 25 });
    const location = await createLocation(adminToken, { name: "Branch D" });
    await stockIn(adminToken, product.body.id, 10, location.body.id);

    const sale = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: product.body.id, quantity: 4 }],
        paymentMethod: "card",
      });
    assert.equal(sale.status, 201);

    const voided = await request(app)
      .post(`/sales/${sale.body.id}/void`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Customer changed their mind" });
    assert.equal(voided.status, 200);
    assert.equal(voided.body.status, "voided");

    const locationStock = await prisma.locationStock.findUnique({
      where: { productId_locationId: { productId: product.body.id, locationId: location.body.id } },
    });
    assert.equal(locationStock.quantity, 10);

    const updatedProduct = await prisma.product.findUnique({ where: { id: product.body.id } });
    assert.equal(updatedProduct.quantity, 10);

    const secondVoid = await request(app)
      .post(`/sales/${sale.body.id}/void`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Again" });
    assert.equal(secondVoid.status, 400);
  });

  test("staff cannot void a sale", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-5", sellingPrice: 10 });
    const location = await createLocation(adminToken, { name: "Branch E" });
    await stockIn(adminToken, product.body.id, 10, location.body.id);

    const sale = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: product.body.id, quantity: 1 }],
        paymentMethod: "card",
      });

    const res = await request(app)
      .post(`/sales/${sale.body.id}/void`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ reason: "test" });
    assert.equal(res.status, 403);
  });

  test("unauthenticated requests to void a sale are rejected", async () => {
    const res = await request(app).post("/sales/1/void").send({ reason: "x" });
    assert.equal(res.status, 401);
  });

  test("GET /sales for a staff user with a homeLocationId only returns sales from their own branch", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-6", sellingPrice: 10 });
    const branchA = await createLocation(adminToken, { name: "Branch F" });
    const branchB = await createLocation(adminToken, { name: "Branch G" });
    await stockIn(adminToken, product.body.id, 10, branchA.body.id);
    await stockIn(adminToken, product.body.id, 10, branchB.body.id);

    const saleA = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        locationId: branchA.body.id,
        items: [{ productId: product.body.id, quantity: 1 }],
        paymentMethod: "card",
      });
    const saleB = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        locationId: branchB.body.id,
        items: [{ productId: product.body.id, quantity: 1 }],
        paymentMethod: "card",
      });
    assert.equal(saleA.status, 201);
    assert.equal(saleB.status, 201);

    await prisma.user.update({ where: { id: staffUser.id }, data: { homeLocationId: branchA.body.id } });

    const res = await request(app).get("/sales").set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, saleA.body.id);
    assert.ok(!res.body.data.some((s) => s.id === saleB.body.id));
  });

  test("rejects a cash sale with amountTendered below the total, and computes changeDue for a valid tender", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-7", sellingPrice: 30 });
    const location = await createLocation(adminToken, { name: "Branch H" });
    await stockIn(adminToken, product.body.id, 10, location.body.id);

    const short = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: product.body.id, quantity: 2 }],
        paymentMethod: "cash",
        amountTendered: 50,
      });
    assert.equal(short.status, 400);

    const valid = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: product.body.id, quantity: 2 }],
        paymentMethod: "cash",
        amountTendered: 100,
      });
    assert.equal(valid.status, 201);
    assert.equal(valid.body.total, 60);
    assert.equal(valid.body.changeDue, 40);
  });

  test("rejects selling a soft-deleted product", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-8", sellingPrice: 10 });
    const location = await createLocation(adminToken, { name: "Branch I" });
    await stockIn(adminToken, product.body.id, 10, location.body.id);
    await request(app)
      .delete(`/products/${product.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: product.body.id, quantity: 1 }],
        paymentMethod: "card",
      });
    assert.equal(res.status, 400);
  });

  test("rejects a sale with a nonexistent locationId", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-9", sellingPrice: 10 });
    const res = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: 999999,
        items: [{ productId: product.body.id, quantity: 1 }],
        paymentMethod: "card",
      });
    assert.equal(res.status, 400);
  });

  test("rejects a sale with a nonexistent productId", async () => {
    const location = await createLocation(adminToken, { name: "Branch J" });
    const res = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: 999999, quantity: 1 }],
        paymentMethod: "card",
      });
    assert.equal(res.status, 400);
  });

  test("rejects a sale with nonexistent modifierOptionIds", async () => {
    const product = await createProduct(adminToken, { sku: "SKU-SALE-10", sellingPrice: 10 });
    const location = await createLocation(adminToken, { name: "Branch K" });
    await stockIn(adminToken, product.body.id, 10, location.body.id);

    const res = await request(app)
      .post("/sales")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        locationId: location.body.id,
        items: [{ productId: product.body.id, quantity: 1, modifierOptionIds: [999999] }],
        paymentMethod: "card",
      });
    assert.equal(res.status, 400);
  });
});
