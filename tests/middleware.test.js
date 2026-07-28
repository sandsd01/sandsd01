const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { requireRole } = require("../src/middleware/auth");

describe("requireRole middleware", () => {
  test("calls next() when the user's role is allowed", () => {
    const req = { user: { role: "admin" } };
    let called = false;
    requireRole("admin", "staff")(req, {}, () => {
      called = true;
    });
    assert.equal(called, true);
  });

  test("responds 403 when the user's role is not allowed", () => {
    const req = { user: { role: "staff" } };
    let statusCode;
    let body;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
      },
    };
    requireRole("admin")(req, res, () => {
      throw new Error("next() should not be called");
    });
    assert.equal(statusCode, 403);
    assert.match(body.error, /forbidden/i);
  });

  test("responds 403 when there is no authenticated user", () => {
    const req = {};
    let statusCode;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json() {},
    };
    requireRole("admin")(req, res, () => {
      throw new Error("next() should not be called");
    });
    assert.equal(statusCode, 403);
  });
});
