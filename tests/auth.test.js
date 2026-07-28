const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser } = require("./helpers/db");
const app = require("../src/app");

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
  });

  test("returns a token and user for valid credentials", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "adminpass1" });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, "admin@test.com");
    assert.equal(res.body.user.role, "admin");
    assert.equal(res.body.user.passwordHash, undefined);
  });

  test("rejects an incorrect password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "wrong-password" });
    assert.equal(res.status, 401);
  });

  test("rejects an unknown email", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@test.com", password: "adminpass1" });
    assert.equal(res.status, 401);
  });

  test("requires email and password", async () => {
    const res = await request(app).post("/auth/login").send({});
    assert.equal(res.status, 400);
  });
});
