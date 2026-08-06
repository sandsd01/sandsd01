const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser } = require("./helpers/db");
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
});
