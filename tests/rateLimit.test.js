const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { authLimiter } = require("../src/middleware/rateLimit");

describe("rate limiting", () => {
  let originalNodeEnv;
  let app;

  before(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    app = express();
    app.use(authLimiter);
    app.get("/x", (_req, res) => res.json({ ok: true }));
  });

  after(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test("blocks a client after exceeding the limit", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get("/x");
      assert.equal(res.status, 200);
    }
    const blocked = await request(app).get("/x");
    assert.equal(blocked.status, 429);
  });
});
