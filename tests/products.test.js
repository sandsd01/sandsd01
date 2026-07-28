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

describe("Products API", () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("requires authentication to list products", async () => {
    const res = await request(app).get("/products");
    assert.equal(res.status, 401);
  });

  test("admin can create a product, starting at quantity 0", async () => {
    const res = await createProduct(adminToken, { sku: "SKU-A", reorderLevel: 2 });
    assert.equal(res.status, 201);
    assert.equal(res.body.quantity, 0);
    assert.equal(res.body.reorderLevel, 2);
  });

  test("staff cannot create a product", async () => {
    const res = await createProduct(staffToken, { sku: "SKU-B" });
    assert.equal(res.status, 403);
  });

  test("rejects a duplicate sku", async () => {
    await createProduct(adminToken, { sku: "SKU-DUP" });
    const res = await createProduct(adminToken, { sku: "SKU-DUP", name: "Other" });
    assert.equal(res.status, 409);
  });

  test("admin can update and delete a product", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-C" });

    const updated = await request(app)
      .patch(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Renamed" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, "Renamed");

    const deleted = await request(app)
      .delete(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(deleted.status, 204);
  });

  test("staff cannot update or delete a product", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-D" });

    const updated = await request(app)
      .patch(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Renamed" });
    assert.equal(updated.status, 403);

    const deleted = await request(app)
      .delete(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(deleted.status, 403);
  });

  test("staff can record a stock-in movement, updating the product quantity", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-E" });

    const res = await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 10, note: "initial stock" });
    assert.equal(res.status, 201);

    const product = await prisma.product.findUnique({ where: { id: created.body.id } });
    assert.equal(product.quantity, 10);
  });

  test("rejects a stock-out movement that exceeds the current quantity", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-F" });
    await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 5 });

    const res = await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "out", quantity: 999 });
    assert.equal(res.status, 400);

    const product = await prisma.product.findUnique({ where: { id: created.body.id } });
    assert.equal(product.quantity, 5, "quantity must be unchanged after a rejected movement");
  });

  test("rejects a movement with an invalid type", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-G" });
    const res = await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "sideways", quantity: 1 });
    assert.equal(res.status, 400);
  });

  test("rejects a movement with a non-positive quantity", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-H" });
    const res = await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 0 });
    assert.equal(res.status, 400);
  });

  test("404s for movements on a non-existent product", async () => {
    const res = await request(app)
      .post("/products/999999/movements")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 1 });
    assert.equal(res.status, 404);
  });

  test("search filters products by sku or name", async () => {
    await createProduct(adminToken, { sku: "SKU-WIDGET", name: "Blue Widget" });
    await createProduct(adminToken, { sku: "SKU-GADGET", name: "Red Gadget" });

    const bySku = await request(app)
      .get("/products?search=WIDGET")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(bySku.status, 200);
    assert.equal(bySku.body.length, 1);
    assert.equal(bySku.body[0].sku, "SKU-WIDGET");

    const byName = await request(app)
      .get("/products?search=Red")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(byName.body.length, 1);
    assert.equal(byName.body[0].sku, "SKU-GADGET");

    const noMatch = await request(app)
      .get("/products?search=nonexistent")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(noMatch.body.length, 0);
  });

  test("exports products as CSV", async () => {
    await createProduct(adminToken, { sku: "SKU-CSV", name: "CSV Widget", reorderLevel: 3 });

    const res = await request(app)
      .get("/products/export")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/csv/);
    assert.match(res.text, /^sku,name,unit,quantity,reorderLevel/);
    assert.match(res.text, /SKU-CSV,CSV Widget,pcs,0,3/);
  });

  test("exports a product's movement history as CSV", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-HIST" });
    await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 7, note: "restock" });

    const res = await request(app)
      .get(`/products/${created.body.id}/movements/export`)
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/csv/);
    assert.match(res.text, /^date,type,quantity,note/);
    assert.match(res.text, /in,7,restock/);
  });

  test("404s exporting movements for a non-existent product", async () => {
    const res = await request(app)
      .get("/products/999999/movements/export")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 404);
  });
});
