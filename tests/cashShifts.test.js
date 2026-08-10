const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser, prisma } = require("./helpers/db");
const app = require("../src/app");

async function login(email, password) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token;
}

describe("Cash shifts", () => {
  let adminToken;
  let staffUser;
  let staffToken;
  let branchA;
  let branchB;
  let productId;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    staffUser = await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");

    const a = await request(app)
      .post("/api/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Shift Branch A" });
    branchA = a.body.id;
    const b = await request(app)
      .post("/api/locations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Shift Branch B" });
    branchB = b.body.id;

    const product = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "SKU-SHIFT", name: "Burger", unit: "pcs", sellingPrice: 100 });
    productId = product.body.id;

    await request(app)
      .post(`/api/products/${productId}/movements`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "in", quantity: 50, locationId: branchA });
  });

  function openShift(token, body) {
    return request(app).post("/api/cash-shifts/open").set("Authorization", `Bearer ${token}`).send(body);
  }

  function sell(token, body) {
    return request(app).post("/api/sales").set("Authorization", `Bearer ${token}`).send(body);
  }

  test("opens a shift with a float and reports nothing taken yet", async () => {
    const res = await openShift(adminToken, { locationId: branchA, openingFloat: 500 });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "open");
    assert.equal(res.body.openingFloat, 500);
    assert.equal(res.body.cashSales, 0);
    assert.equal(res.body.expectedCash, 500, "expected cash starts at the float");
    assert.equal(res.body.saleCount, 0);
  });

  test("a branch cannot have two open shifts at once", async () => {
    await openShift(adminToken, { locationId: branchA, openingFloat: 500 });
    const second = await openShift(adminToken, { locationId: branchA, openingFloat: 300 });
    assert.equal(second.status, 409);
  });

  test("another branch can open its own shift independently", async () => {
    await openShift(adminToken, { locationId: branchA, openingFloat: 500 });
    const other = await openShift(adminToken, { locationId: branchB, openingFloat: 200 });
    assert.equal(other.status, 201);
  });

  test("rejects a negative or missing opening float", async () => {
    const negative = await openShift(adminToken, { locationId: branchA, openingFloat: -1 });
    assert.equal(negative.status, 400);
    const missing = await openShift(adminToken, { locationId: branchA });
    assert.equal(missing.status, 400);
  });

  test("only cash sales count toward the drawer", async () => {
    const shift = await openShift(adminToken, { locationId: branchA, openingFloat: 500 });

    await sell(adminToken, {
      locationId: branchA,
      items: [{ productId, quantity: 1 }],
      paymentMethod: "cash",
    });
    // Card and PromptPay money never reaches the till, so it must not inflate
    // the expected cash a cashier is asked to count.
    await sell(adminToken, {
      locationId: branchA,
      items: [{ productId, quantity: 1 }],
      paymentMethod: "card",
    });
    await sell(adminToken, {
      locationId: branchA,
      items: [{ productId, quantity: 1 }],
      paymentMethod: "promptpay",
    });

    const current = await request(app)
      .get(`/api/cash-shifts/current?locationId=${branchA}`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(current.body.id, shift.body.id);
    assert.equal(current.body.cashSales, 100, "only the cash sale counts");
    assert.equal(current.body.expectedCash, 600, "500 float + 100 cash");
    assert.equal(current.body.saleCount, 3, "but all three sales belong to the shift");
  });

  test("closing computes the variance against what was counted", async () => {
    const shift = await openShift(adminToken, { locationId: branchA, openingFloat: 500 });
    await sell(adminToken, {
      locationId: branchA,
      items: [{ productId, quantity: 2 }],
      paymentMethod: "cash",
    });

    // Expected 500 + 200 = 700; the drawer is 20 short.
    const res = await request(app)
      .post(`/api/cash-shifts/${shift.body.id}/close`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ countedCash: 680, note: "till short" });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "closed");
    assert.equal(res.body.expectedCash, 700);
    assert.equal(res.body.countedCash, 680);
    assert.equal(res.body.variance, -20, "a short drawer is negative");
    assert.ok(res.body.closedAt);
  });

  test("an over-counted drawer gives a positive variance", async () => {
    const shift = await openShift(adminToken, { locationId: branchA, openingFloat: 100 });
    const res = await request(app)
      .post(`/api/cash-shifts/${shift.body.id}/close`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ countedCash: 105.5 });
    assert.equal(res.body.variance, 5.5);
  });

  test("a shift cannot be closed twice", async () => {
    const shift = await openShift(adminToken, { locationId: branchA, openingFloat: 100 });
    await request(app)
      .post(`/api/cash-shifts/${shift.body.id}/close`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ countedCash: 100 });
    const again = await request(app)
      .post(`/api/cash-shifts/${shift.body.id}/close`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ countedCash: 100 });
    assert.equal(again.status, 400);
  });

  test("closing after a shift ends leaves later sales out of it", async () => {
    const shift = await openShift(adminToken, { locationId: branchA, openingFloat: 0 });
    await sell(adminToken, {
      locationId: branchA,
      items: [{ productId, quantity: 1 }],
      paymentMethod: "cash",
    });
    await request(app)
      .post(`/api/cash-shifts/${shift.body.id}/close`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ countedCash: 100 });

    // With no shift open, trading still works — it just isn't reconciled.
    const after = await sell(adminToken, {
      locationId: branchA,
      items: [{ productId, quantity: 1 }],
      paymentMethod: "cash",
    });
    assert.equal(after.status, 201);
    assert.equal(after.body.cashShiftId, null);

    const closed = await prisma.cashShift.findUnique({ where: { id: shift.body.id } });
    assert.equal(Number(closed.variance), 0, "the closed shift keeps its own figures");
  });

  test("staff are pinned to their own branch for opening and closing", async () => {
    await prisma.user.update({ where: { id: staffUser.id }, data: { homeLocationId: branchA } });

    const wrongBranch = await openShift(staffToken, { locationId: branchB, openingFloat: 100 });
    assert.equal(wrongBranch.status, 403);

    const ownBranch = await openShift(staffToken, { locationId: branchA, openingFloat: 100 });
    assert.equal(ownBranch.status, 201);

    // A shift opened at another branch is not theirs to close either.
    const otherShift = await openShift(adminToken, { locationId: branchB, openingFloat: 50 });
    const closeOther = await request(app)
      .post(`/api/cash-shifts/${otherShift.body.id}/close`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ countedCash: 50 });
    assert.equal(closeOther.status, 403);
  });

  test("staff only see their own branch's shift history", async () => {
    await prisma.user.update({ where: { id: staffUser.id }, data: { homeLocationId: branchA } });
    await openShift(adminToken, { locationId: branchA, openingFloat: 10 });
    await openShift(adminToken, { locationId: branchB, openingFloat: 20 });

    const res = await request(app)
      .get("/api/cash-shifts")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].locationId, branchA);
  });

  test("the history list carries expected cash for open shifts too", async () => {
    const shift = await openShift(adminToken, { locationId: branchA, openingFloat: 500 });
    await sell(adminToken, {
      locationId: branchA,
      items: [{ productId, quantity: 1 }],
      paymentMethod: "cash",
    });

    // The list has to report expectedCash itself: a still-open shift has no
    // countedCash/variance to derive it from, so the client can't work it out.
    const res = await request(app)
      .get(`/api/cash-shifts?locationId=${branchA}`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    const row = res.body.data.find((r) => r.id === shift.body.id);
    assert.equal(row.cashSales, 100);
    assert.equal(row.expectedCash, 600);
    assert.equal(row.saleCount, 1);
    assert.equal(row.countedCash, null);
  });

  test("shifts with no sales still report their float as expected cash", async () => {
    await openShift(adminToken, { locationId: branchA, openingFloat: 250 });
    const res = await request(app)
      .get(`/api/cash-shifts?locationId=${branchA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.body.data[0].cashSales, 0, "no sales grouped to this shift at all");
    assert.equal(res.body.data[0].expectedCash, 250);
    assert.equal(res.body.data[0].saleCount, 0);
  });

  test("requires authentication", async () => {
    const res = await request(app).post("/api/cash-shifts/open").send({ locationId: branchA, openingFloat: 0 });
    assert.equal(res.status, 401);
  });

  test("current returns null when no shift is open", async () => {
    const res = await request(app)
      .get(`/api/cash-shifts/current?locationId=${branchA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body, null);
  });
});
