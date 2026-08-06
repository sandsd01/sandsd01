const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser, prisma } = require("./helpers/db");
const app = require("../src/app");

async function login(email, password) {
  const res = await request(app).post("/auth/login").send({ email, password });
  return res.body.token;
}

describe("Purchase Orders API", () => {
  let adminToken;
  let staffToken;
  let supplier;
  let product;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");

    const supplierRes = await request(app)
      .post("/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Acme Supplies" });
    supplier = supplierRes.body;

    const productRes = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-PO", name: "PO Widget", unit: "pcs", reorderLevel: 5, unitCost: 2 });
    product = productRes.body;
  });

  function createOrder(overrides = {}) {
    return request(app)
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        supplierId: supplier.id,
        items: [{ productId: product.id, quantityOrdered: 10, unitCost: 2 }],
        ...overrides,
      });
  }

  test("requires authentication", async () => {
    const res = await request(app).get("/purchase-orders");
    assert.equal(res.status, 401);
  });

  test("admin can create a draft purchase order", async () => {
    const res = await createOrder();
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "draft");
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].quantityOrdered, 10);
    assert.equal(res.body.items[0].quantityReceived, 0);
  });

  test("staff cannot create a purchase order", async () => {
    const res = await createOrder().set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 403);
  });

  test("rejects creating an order with no items", async () => {
    const res = await createOrder({ items: [] });
    assert.equal(res.status, 400);
  });

  test("rejects creating an order for an unknown product", async () => {
    const res = await createOrder({ items: [{ productId: 999999, quantityOrdered: 1 }] });
    assert.equal(res.status, 400);
  });

  test("admin can edit a draft order's items", async () => {
    const created = await createOrder();
    const res = await request(app)
      .patch(`/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ productId: product.id, quantityOrdered: 20 }] });
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].quantityOrdered, 20);
  });

  test("admin can delete a draft order", async () => {
    const created = await createOrder();
    const res = await request(app)
      .delete(`/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 204);

    const get = await request(app)
      .get(`/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(get.status, 404);
  });

  test("marks a draft order as ordered", async () => {
    const created = await createOrder();
    const res = await request(app)
      .post(`/purchase-orders/${created.body.id}/mark-ordered`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ordered");
    assert.ok(res.body.orderedAt);
  });

  test("cannot edit or delete an order once it's ordered", async () => {
    const created = await createOrder();
    await request(app)
      .post(`/purchase-orders/${created.body.id}/mark-ordered`)
      .set("Authorization", `Bearer ${adminToken}`);

    const patch = await request(app)
      .patch(`/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: "changed" });
    assert.equal(patch.status, 400);

    const del = await request(app)
      .delete(`/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(del.status, 400);
  });

  test("cancels a draft or ordered purchase order", async () => {
    const created = await createOrder();
    await request(app)
      .post(`/purchase-orders/${created.body.id}/mark-ordered`)
      .set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app)
      .post(`/purchase-orders/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "cancelled");
  });

  test("receiving stock updates product quantity, item receipt, and order status", async () => {
    const created = await createOrder({
      items: [{ productId: product.id, quantityOrdered: 10 }],
    });
    await request(app)
      .post(`/purchase-orders/${created.body.id}/mark-ordered`)
      .set("Authorization", `Bearer ${adminToken}`);

    const itemId = created.body.items[0].id;

    const partial = await request(app)
      .post(`/purchase-orders/${created.body.id}/receive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ itemId, quantity: 4 }] });
    assert.equal(partial.status, 200);
    assert.equal(partial.body.status, "partially_received");
    assert.equal(partial.body.items[0].quantityReceived, 4);

    let updatedProduct = await prisma.product.findUnique({ where: { id: product.id } });
    assert.equal(updatedProduct.quantity, 4);

    const full = await request(app)
      .post(`/purchase-orders/${created.body.id}/receive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ itemId, quantity: 6 }] });
    assert.equal(full.status, 200);
    assert.equal(full.body.status, "received");
    assert.ok(full.body.receivedAt);

    updatedProduct = await prisma.product.findUnique({ where: { id: product.id } });
    assert.equal(updatedProduct.quantity, 10);

    const movements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
    assert.equal(movements.length, 2);
    assert.ok(movements.every((m) => m.type === "in" && m.note.includes(`PO #${created.body.id}`)));
  });

  test("receiving stock against a location tags the resulting movement", async () => {
    const location = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Receiving Dock" });

    const created = await createOrder({ items: [{ productId: product.id, quantityOrdered: 5 }] });
    await request(app)
      .post(`/purchase-orders/${created.body.id}/mark-ordered`)
      .set("Authorization", `Bearer ${adminToken}`);

    await request(app)
      .post(`/purchase-orders/${created.body.id}/receive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        items: [{ itemId: created.body.items[0].id, quantity: 5 }],
        locationId: location.body.id,
      });

    const movements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].locationId, location.body.id);
  });

  test("rejects receiving more than the remaining ordered quantity", async () => {
    const created = await createOrder({
      items: [{ productId: product.id, quantityOrdered: 5 }],
    });
    await request(app)
      .post(`/purchase-orders/${created.body.id}/mark-ordered`)
      .set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app)
      .post(`/purchase-orders/${created.body.id}/receive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ itemId: created.body.items[0].id, quantity: 999 }] });
    assert.equal(res.status, 400);

    const updatedProduct = await prisma.product.findUnique({ where: { id: product.id } });
    assert.equal(updatedProduct.quantity, 0, "quantity must be unchanged after a rejected receipt");
  });

  test("cannot receive stock on a draft order", async () => {
    const created = await createOrder();
    const res = await request(app)
      .post(`/purchase-orders/${created.body.id}/receive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ itemId: created.body.items[0].id, quantity: 1 }] });
    assert.equal(res.status, 400);
  });

  test("staff cannot receive stock, cancel, or mark an order as ordered", async () => {
    const created = await createOrder();
    const markOrdered = await request(app)
      .post(`/purchase-orders/${created.body.id}/mark-ordered`)
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(markOrdered.status, 403);

    const cancel = await request(app)
      .post(`/purchase-orders/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(cancel.status, 403);

    const receive = await request(app)
      .post(`/purchase-orders/${created.body.id}/receive`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ items: [{ itemId: created.body.items[0].id, quantity: 1 }] });
    assert.equal(receive.status, 403);
  });

  test("cannot delete a supplier that has purchase orders", async () => {
    await createOrder();
    const res = await request(app)
      .delete(`/suppliers/${supplier.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 409);
  });

  test("cannot permanently delete a product referenced by a purchase order", async () => {
    await createOrder();
    await request(app)
      .delete(`/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app)
      .delete(`/products/${product.id}/permanent`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 409);
  });

  test("filters the list by status and supplier", async () => {
    const created = await createOrder();
    await request(app)
      .post(`/purchase-orders/${created.body.id}/mark-ordered`)
      .set("Authorization", `Bearer ${adminToken}`);
    await createOrder();

    const byStatus = await request(app)
      .get("/purchase-orders?status=draft")
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(byStatus.body.data.length, 1);
    assert.equal(byStatus.body.data[0].status, "draft");

    const bySupplier = await request(app)
      .get(`/purchase-orders?supplierId=${supplier.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(bySupplier.body.total, 2);
  });
});
