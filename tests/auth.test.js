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

describe("PATCH /auth/password", () => {
  let token;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "adminpass1" });
    token = login.body.token;
  });

  test("requires authentication", async () => {
    const res = await request(app)
      .patch("/auth/password")
      .send({ currentPassword: "adminpass1", newPassword: "newpassword1" });
    assert.equal(res.status, 401);
  });

  test("changes the password and allows login with the new one", async () => {
    const res = await request(app)
      .patch("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "adminpass1", newPassword: "newpassword1" });
    assert.equal(res.status, 200);

    const oldLogin = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "adminpass1" });
    assert.equal(oldLogin.status, 401);

    const newLogin = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "newpassword1" });
    assert.equal(newLogin.status, 200);
  });

  test("rejects an incorrect current password", async () => {
    const res = await request(app)
      .patch("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "wrong", newPassword: "newpassword1" });
    assert.equal(res.status, 401);
  });

  test("rejects a new password shorter than 8 characters", async () => {
    const res = await request(app)
      .patch("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "adminpass1", newPassword: "short" });
    assert.equal(res.status, 400);
  });
});

describe("Account lockout", () => {
  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
  });

  test("locks the account after 5 failed attempts", async () => {
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "admin@test.com", password: "wrong" });
      assert.equal(res.status, 401);
    }

    const fifthAttempt = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "wrong" });
    assert.equal(fifthAttempt.status, 423);

    const correctPasswordWhileLocked = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "adminpass1" });
    assert.equal(correctPasswordWhileLocked.status, 423);
  });

  test("a successful login resets the failed attempt counter", async () => {
    await request(app).post("/auth/login").send({ email: "admin@test.com", password: "wrong" });
    await request(app).post("/auth/login").send({ email: "admin@test.com", password: "wrong" });

    const success = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "adminpass1" });
    assert.equal(success.status, 200);

    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "admin@test.com", password: "wrong" });
      assert.equal(res.status, 401, "counter should have reset after the successful login");
    }
  });
});
