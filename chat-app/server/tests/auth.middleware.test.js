const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret";
const { authenticate } = require("../src/middleware/auth");

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test("rejects requests with no Authorization header", () => {
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;
  authenticate(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("rejects a malformed Authorization header", () => {
  const req = { headers: { authorization: "not-bearer-scheme" } };
  const res = mockRes();
  let nextCalled = false;
  authenticate(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("rejects an invalid token", () => {
  const req = { headers: { authorization: "Bearer not-a-real-token" } };
  const res = mockRes();
  let nextCalled = false;
  authenticate(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("rejects an expired token", () => {
  const token = jwt.sign({ sub: "user-123", email: "a@example.com" }, process.env.JWT_SECRET, {
    expiresIn: -10,
  });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nextCalled = false;
  authenticate(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("attaches req.user from a valid token and calls next", () => {
  const token = jwt.sign({ sub: "user-123", email: "a@example.com" }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nextCalled = false;
  authenticate(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, { id: "user-123", email: "a@example.com" });
});
