const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser } = require("./helpers/db");
const app = require("../src/app");

async function login(email, password) {
  const res = await request(app).post("/auth/login").send({ email, password });
  return res.body.token;
}

describe("GET /reports/summary", () => {
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/reports/summary");
    assert.equal(res.status, 401);
  });

  test("summarizes product counts, quantity, and low stock", async () => {
    const adminToken = await login("admin@test.com", "adminpass1");
    await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-LOW", name: "Low Widget", unit: "pcs", reorderLevel: 10 });
    await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-OK", name: "OK Widget", unit: "pcs", reorderLevel: 1 });

    const products = await request(app).get("/products").set("Authorization", `Bearer ${staffToken}`);
    const [low, ok] = products.body;

    await request(app)
      .post(`/products/${ok.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 20 });

    const res = await request(app)
      .get("/reports/summary")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalProducts, 2);
    assert.equal(res.body.totalQuantity, 20);
    assert.equal(res.body.lowStockCount, 1);
    assert.equal(res.body.lowStockProducts[0].sku, low.sku);
    assert.equal(res.body.recentMovements.length, 1);
    assert.equal(res.body.recentMovements[0].createdByEmail, "staff@test.com");
  });
});
