const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser } = require("./helpers/db");
const app = require("../src/app");

async function login(email, password) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
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
    const res = await request(app).get("/api/reports/summary");
    assert.equal(res.status, 401);
  });

  test("summarizes product counts, quantity, and low stock", async () => {
    const adminToken = await login("admin@test.com", "adminpass1");
    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-LOW", name: "Low Widget", unit: "pcs", reorderLevel: 10 });
    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-OK", name: "OK Widget", unit: "pcs", reorderLevel: 1 });

    const products = await request(app).get("/api/products").set("Authorization", `Bearer ${staffToken}`);
    const [low, ok] = products.body.data;

    await request(app)
      .post(`/api/products/${ok.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 20 });

    const res = await request(app)
      .get("/api/reports/summary")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalProducts, 2);
    assert.equal(res.body.totalQuantity, 20);
    assert.equal(res.body.lowStockCount, 1);
    assert.equal(res.body.lowStockProducts[0].sku, low.sku);
    assert.equal(res.body.recentMovements.length, 1);
    assert.equal(res.body.recentMovements[0].createdByEmail, "staff@test.com");
  });

  test("computes total inventory value from unit cost * quantity", async () => {
    const adminToken = await login("admin@test.com", "adminpass1");
    const product = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-VAL", name: "Priced Widget", unit: "pcs", unitCost: 2.5 });
    await request(app)
      .post(`/api/products/${product.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 10 });

    const res = await request(app)
      .get("/api/reports/summary")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.body.totalValue, 25);
  });
});

describe("GET /reports/movements-timeseries", () => {
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
    const res = await request(app).get("/api/reports/movements-timeseries");
    assert.equal(res.status, 401);
  });

  test("aggregates today's movements into the returned series", async () => {
    const product = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-TS", name: "Widget", unit: "pcs" });
    await request(app)
      .post(`/api/products/${product.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "in", quantity: 15 });
    await request(app)
      .post(`/api/products/${product.body.id}/movements`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ type: "out", quantity: 4 });

    const res = await request(app)
      .get("/api/reports/movements-timeseries?days=7")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 7);
    const today = res.body[res.body.length - 1];
    assert.equal(today.in, 15);
    assert.equal(today.out, 4);
  });
});

describe("POST /reports/send-low-stock-alert", () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("staff cannot trigger the alert", async () => {
    const res = await request(app)
      .post("/api/reports/send-low-stock-alert")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 403);
  });

  test("admin can trigger it; skips sending when Resend isn't configured", async () => {
    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-ALERT", name: "Widget", unit: "pcs", reorderLevel: 5 });

    const res = await request(app)
      .post("/api/reports/send-low-stock-alert")
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.sent, false);
  });
});

describe("GET /reports/summary/pdf", () => {
  let adminToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    adminToken = await login("admin@test.com", "adminpass1");
  });

  test("returns a PDF document", async () => {
    const res = await request(app)
      .get("/api/reports/summary/pdf")
      .set("Authorization", `Bearer ${adminToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/pdf/);
    assert.equal(res.body.slice(0, 4).toString(), "%PDF");
  });
});

describe("POST /reports/send-daily-summary", () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("staff cannot trigger the daily summary", async () => {
    const res = await request(app)
      .post("/api/reports/send-daily-summary")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 403);
  });

  test("admin can trigger it; skips sending when Resend isn't configured", async () => {
    const res = await request(app)
      .post("/api/reports/send-daily-summary")
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.sent, false);
  });
});

describe("GET /reports/activity-log", () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("staff cannot view the activity log", async () => {
    const res = await request(app)
      .get("/api/reports/activity-log")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 403);
  });

  test("records and lists actions with the acting user's email", async () => {
    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-LOG", name: "Widget", unit: "pcs" });

    const res = await request(app)
      .get("/api/reports/activity-log")
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 1);
    const entry = res.body.data.find((e) => e.entityType === "product" && e.action === "create");
    assert.ok(entry);
    assert.equal(entry.userEmail, "admin@test.com");
    assert.equal(entry.details.sku, "SKU-LOG");
  });
});
