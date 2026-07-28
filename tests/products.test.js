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
    assert.equal(bySku.body.data.length, 1);
    assert.equal(bySku.body.data[0].sku, "SKU-WIDGET");
    assert.equal(bySku.body.total, 1);

    const byName = await request(app)
      .get("/products?search=Red")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(byName.body.data.length, 1);
    assert.equal(byName.body.data[0].sku, "SKU-GADGET");

    const noMatch = await request(app)
      .get("/products?search=nonexistent")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(noMatch.body.data.length, 0);
  });

  test("filters products by category", async () => {
    await createProduct(adminToken, { sku: "SKU-CAT-A", category: "Apparel" });
    await createProduct(adminToken, { sku: "SKU-CAT-B", category: "Electronics" });

    const res = await request(app)
      .get("/products?category=Apparel")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].sku, "SKU-CAT-A");
  });

  test("lists distinct categories", async () => {
    await createProduct(adminToken, { sku: "SKU-CAT-C", category: "Apparel" });
    await createProduct(adminToken, { sku: "SKU-CAT-D", category: "Apparel" });
    await createProduct(adminToken, { sku: "SKU-CAT-E", category: null });

    const res = await request(app)
      .get("/products/categories")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.deepEqual(res.body, ["Apparel"]);
  });

  test("paginates and sorts the product list", async () => {
    await createProduct(adminToken, { sku: "SKU-P1", name: "Alpha" });
    await createProduct(adminToken, { sku: "SKU-P2", name: "Beta" });
    await createProduct(adminToken, { sku: "SKU-P3", name: "Gamma" });

    const page1 = await request(app)
      .get("/products?pageSize=2&page=1&sortBy=name&sortDir=asc")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(page1.body.data.length, 2);
    assert.equal(page1.body.total, 3);
    assert.deepEqual(
      page1.body.data.map((p) => p.name),
      ["Alpha", "Beta"]
    );

    const page2 = await request(app)
      .get("/products?pageSize=2&page=2&sortBy=name&sortDir=asc")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(page2.body.data.length, 1);
    assert.equal(page2.body.data[0].name, "Gamma");
  });

  test("exports products as CSV", async () => {
    await createProduct(adminToken, { sku: "SKU-CSV", name: "CSV Widget", reorderLevel: 3 });

    const res = await request(app)
      .get("/products/export")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/csv/);
    assert.match(res.text, /^sku,name,unit,category,quantity,reorderLevel/);
    assert.match(res.text, /SKU-CSV,CSV Widget,pcs,,0,3/);
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

  test("admin can delete a movement, reversing the quantity change", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-DEL" });
    const movement = await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 10 });

    const res = await request(app)
      .delete(`/products/${created.body.id}/movements/${movement.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 204);

    const product = await prisma.product.findUnique({ where: { id: created.body.id } });
    assert.equal(product.quantity, 0);

    const movements = await prisma.stockMovement.findMany({ where: { productId: created.body.id } });
    assert.equal(movements.length, 0);
  });

  test("staff cannot delete a movement", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-DEL2" });
    const movement = await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 10 });

    const res = await request(app)
      .delete(`/products/${created.body.id}/movements/${movement.body.id}`)
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 403);
  });

  test("rejects deleting a movement that would take quantity negative", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-DEL3" });
    const inMovement = await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 10 });
    await request(app)
      .post(`/products/${created.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "out", quantity: 8 });

    const res = await request(app)
      .delete(`/products/${created.body.id}/movements/${inMovement.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 400);
  });

  test("404s deleting a non-existent movement", async () => {
    const created = await createProduct(adminToken, { sku: "SKU-DEL4" });
    const res = await request(app)
      .delete(`/products/${created.body.id}/movements/999999`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 404);
  });

  test("admin can import products from CSV, creating and updating by sku", async () => {
    await createProduct(adminToken, { sku: "SKU-IMP-1", name: "Old Name", unit: "pcs", reorderLevel: 1 });

    const csv =
      "sku,name,unit,category,reorderLevel\n" +
      "SKU-IMP-1,Updated Name,pcs,Apparel,5\n" +
      "SKU-IMP-2,New Product,box,Electronics,2\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv });

    assert.equal(res.status, 200);
    assert.equal(res.body.created, 1);
    assert.equal(res.body.updated, 1);
    assert.equal(res.body.errors.length, 0);

    const updated = await prisma.product.findUnique({ where: { sku: "SKU-IMP-1" } });
    assert.equal(updated.name, "Updated Name");
    assert.equal(updated.reorderLevel, 5);
    assert.equal(updated.category, "Apparel");

    const created = await prisma.product.findUnique({ where: { sku: "SKU-IMP-2" } });
    assert.ok(created);
    assert.equal(created.category, "Electronics");
  });

  test("reports per-row errors for invalid CSV import rows", async () => {
    const csv = "sku,name,unit\n" + ",Missing Sku,pcs\n" + "SKU-IMP-OK,Valid,pcs\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ csv });

    assert.equal(res.status, 200);
    assert.equal(res.body.created, 1);
    assert.equal(res.body.errors.length, 1);
    assert.equal(res.body.errors[0].row, 2);
  });

  test("staff cannot import products", async () => {
    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ csv: "sku,name,unit\nSKU-X,X,pcs\n" });
    assert.equal(res.status, 403);
  });
});
