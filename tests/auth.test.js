const crypto = require("node:crypto");
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, createUser, prisma } = require("./helpers/db");
const app = require("../src/app");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

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

describe("GET /auth/me", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/auth/me");
    assert.equal(res.status, 401);
  });

  test("returns the caller's own profile without the password hash", async () => {
    await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "adminpass1" });

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.email, "admin@test.com");
    assert.equal(res.body.role, "admin");
    assert.equal(res.body.homeLocationId, null);
    assert.equal(res.body.passwordHash, undefined);
  });

  test("exposes a staff member's home branch, and login returns it too", async () => {
    const location = await prisma.location.create({ data: { name: "Siam Branch" } });
    const staff = await createUser({
      email: "staff@test.com",
      password: "staffpass1",
      role: "staff",
    });
    await prisma.user.update({
      where: { id: staff.id },
      data: { homeLocationId: location.id },
    });

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "staff@test.com", password: "staffpass1" });
    assert.equal(login.body.user.homeLocationId, location.id);

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.homeLocationId, location.id);
    assert.equal(res.body.role, "staff");
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

describe("Password reset", () => {
  let user;

  beforeEach(async () => {
    await resetDb();
    user = await createUser({ email: "admin@test.com", password: "adminpass1", role: "admin" });
  });

  test("forgot-password returns a generic message for both existing and unknown emails", async () => {
    const known = await request(app).post("/auth/forgot-password").send({ email: "admin@test.com" });
    const unknown = await request(app)
      .post("/auth/forgot-password")
      .send({ email: "nobody@test.com" });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(known.body.message, unknown.body.message);
  });

  test("forgot-password sets a reset token on the user", async () => {
    await request(app).post("/auth/forgot-password").send({ email: "admin@test.com" });
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    assert.ok(updated.resetTokenHash);
    assert.ok(updated.resetTokenExpiresAt > new Date());
  });

  test("reset-password with a valid token updates the password and unlocks the account", async () => {
    const token = "test-reset-token";
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashToken(token),
        resetTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        failedLoginAttempts: 3,
      },
    });

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ email: "admin@test.com", token, newPassword: "brandnewpass1" });
    assert.equal(res.status, 200);

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "brandnewpass1" });
    assert.equal(login.status, 200);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(updated.resetTokenHash, null);
    assert.equal(updated.failedLoginAttempts, 0);
  });

  test("reset-password rejects an invalid token", async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashToken("real-token"),
        resetTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ email: "admin@test.com", token: "wrong-token", newPassword: "brandnewpass1" });
    assert.equal(res.status, 400);
  });

  test("reset-password rejects an expired token", async () => {
    const token = "expired-token";
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashToken(token),
        resetTokenExpiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ email: "admin@test.com", token, newPassword: "brandnewpass1" });
    assert.equal(res.status, 400);
  });

  test("reset-password rejects a new password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ email: "admin@test.com", token: "whatever", newPassword: "short" });
    assert.equal(res.status, 400);
  });
});
