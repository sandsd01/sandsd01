const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser, prisma } = require("./helpers/db");
const app = require("../src/app");

async function login(email, password) {
  const res = await request(app).post("/auth/login").send({ email, password });
  return res.body.token;
}

describe("Suppliers API", () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("requires authentication to list suppliers", async () => {
    const res = await request(app).get("/suppliers");
    assert.equal(res.status, 401);
  });

  test("admin can create a supplier", async () => {
    const res = await request(app)
      .post("/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Acme Corp", contactEmail: "sales@acme.test" });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, "Acme Corp");
  });

  test("staff cannot create a supplier", async () => {
    const res = await request(app)
      .post("/suppliers")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Acme Corp" });
    assert.equal(res.status, 403);
  });

  test("rejects a duplicate supplier name", async () => {
    await request(app)
      .post("/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Acme Corp" });
    const res = await request(app)
      .post("/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Acme Corp" });
    assert.equal(res.status, 409);
  });

  test("admin can update a supplier", async () => {
    const created = await request(app)
      .post("/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Acme Corp" });
    const res = await request(app)
      .patch(`/suppliers/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ contactPhone: "555-1234" });
    assert.equal(res.status, 200);
    assert.equal(res.body.contactPhone, "555-1234");
  });

  test("deleting a supplier unlinks it from products instead of failing", async () => {
    const supplier = await request(app)
      .post("/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Acme Corp" });
    const product = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-SUP", name: "Widget", unit: "pcs", supplierId: supplier.body.id });
    assert.equal(product.body.supplierId, supplier.body.id);

    const del = await request(app)
      .delete(`/suppliers/${supplier.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(del.status, 204);

    const refreshed = await prisma.product.findUnique({ where: { id: product.body.id } });
    assert.equal(refreshed.supplierId, null);
  });
});
