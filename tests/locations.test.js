const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser, prisma } = require("./helpers/db");
const app = require("../src/app");

async function login(email, password) {
  const res = await request(app).post("/auth/login").send({ email, password });
  return res.body.token;
}

describe("Locations API", () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/locations");
    assert.equal(res.status, 401);
  });

  test("admin can create a location", async () => {
    const res = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Main Warehouse" });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, "Main Warehouse");
  });

  test("staff cannot create a location", async () => {
    const res = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Main Warehouse" });
    assert.equal(res.status, 403);
  });

  test("rejects a duplicate location name", async () => {
    await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Main Warehouse" });
    const res = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Main Warehouse" });
    assert.equal(res.status, 409);
  });

  test("staff can list locations", async () => {
    await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Main Warehouse" });
    const res = await request(app).get("/locations").set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
  });

  test("admin can update and delete an unused location", async () => {
    const created = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Main Warehouse" });

    const updated = await request(app)
      .patch(`/locations/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Central Warehouse" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, "Central Warehouse");

    const deleted = await request(app)
      .delete(`/locations/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(deleted.status, 204);
  });

  test("cannot delete a location that has recorded movements", async () => {
    const location = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Main Warehouse" });

    const product = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-LOC", name: "Widget", unit: "pcs" });

    await request(app)
      .post(`/products/${product.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 5, locationId: location.body.id });

    const res = await request(app)
      .delete(`/locations/${location.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 409);
  });

  test("address/phone/isActive round-trip through create and update", async () => {
    const created = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Branch Info", address: "123 Main St", phone: "555-0100", isActive: false });
    assert.equal(created.status, 201);
    assert.equal(created.body.address, "123 Main St");
    assert.equal(created.body.phone, "555-0100");
    assert.equal(created.body.isActive, false);

    const updated = await request(app)
      .patch(`/locations/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ address: "456 Elm St", phone: "555-0200", isActive: true });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.address, "456 Elm St");
    assert.equal(updated.body.phone, "555-0200");
    assert.equal(updated.body.isActive, true);
  });

  test("a location created without isActive defaults to active", async () => {
    const created = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Default Active Branch" });
    assert.equal(created.status, 201);
    assert.equal(created.body.isActive, true);
  });

  test("GET /:id/stock returns quantities for products stocked at that branch", async () => {
    const location = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Stocked Branch" });

    const productA = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-STOCK-A", name: "Widget A", unit: "pcs", sellingPrice: 15 });
    const productB = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-STOCK-B", name: "Widget B", unit: "pcs", sellingPrice: 25 });

    await request(app)
      .post(`/products/${productA.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 12, locationId: location.body.id });
    await request(app)
      .post(`/products/${productB.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 4, locationId: location.body.id });

    const res = await request(app)
      .get(`/locations/${location.body.id}/stock`)
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);

    const entryA = res.body.find((e) => e.productId === productA.body.id);
    const entryB = res.body.find((e) => e.productId === productB.body.id);
    assert.equal(entryA.quantity, 12);
    assert.equal(entryA.product.sku, "SKU-STOCK-A");
    assert.equal(entryA.product.sellingPrice, 15);
    assert.equal(entryB.quantity, 4);
    assert.equal(entryB.product.sku, "SKU-STOCK-B");
  });

  test("404s getting stock for a non-existent location", async () => {
    const res = await request(app)
      .get("/locations/999999/stock")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 404);
  });

  test("cannot delete a location that has a LocationStock row with quantity > 0, even with no recorded movements", async () => {
    const location = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Phantom Stock Branch" });
    const product = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-PHANTOM", name: "Phantom Widget", unit: "pcs" });

    // Simulate a LocationStock row with no backing StockMovement, isolating the
    // hasStock guard from the pre-existing hasMovements guard.
    await prisma.locationStock.create({
      data: { productId: product.body.id, locationId: location.body.id, quantity: 5 },
    });
    const movements = await prisma.stockMovement.findMany({ where: { locationId: location.body.id } });
    assert.equal(movements.length, 0, "sanity check: no movements reference this location");

    const res = await request(app)
      .delete(`/locations/${location.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 409);
  });
});
