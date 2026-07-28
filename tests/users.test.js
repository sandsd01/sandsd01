const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser } = require("./helpers/db");
const app = require("../src/app");

async function login(email, password) {
  const res = await request(app).post("/auth/login").send({ email, password });
  return res.body.token;
}

describe("Users API", () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    await createUser({ email: "staff@test.com", password: "staffpass1", role: "staff" });
    adminToken = await login("admin@test.com", "adminpass1");
    staffToken = await login("staff@test.com", "staffpass1");
  });

  test("admin can list users without exposing password hashes", async () => {
    const res = await request(app).get("/users").set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    for (const user of res.body) {
      assert.equal(user.passwordHash, undefined);
    }
  });

  test("staff cannot list users", async () => {
    const res = await request(app).get("/users").set("Authorization", `Bearer ${staffToken}`);
    assert.equal(res.status, 403);
  });

  test("admin can create a new user", async () => {
    const res = await request(app)
      .post("/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "new@test.com", password: "newpass123", role: "staff" });
    assert.equal(res.status, 201);
    assert.equal(res.body.email, "new@test.com");
    assert.equal(res.body.role, "staff");
  });

  test("rejects creating a user with a duplicate email", async () => {
    const res = await request(app)
      .post("/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "admin@test.com", password: "whatever1" });
    assert.equal(res.status, 409);
  });

  test("admin can change a user's role", async () => {
    const created = await request(app)
      .post("/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "promote@test.com", password: "pass12345", role: "staff" });

    const updated = await request(app)
      .patch(`/users/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "admin" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.role, "admin");
  });

  test("admin can delete a user", async () => {
    const created = await request(app)
      .post("/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "temp@test.com", password: "pass12345" });

    const deleted = await request(app)
      .delete(`/users/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(deleted.status, 204);
  });

  test("staff cannot create, update, or delete users", async () => {
    const create = await request(app)
      .post("/users")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ email: "blocked@test.com", password: "pass12345" });
    assert.equal(create.status, 403);
  });
});
