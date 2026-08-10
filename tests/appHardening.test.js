const fs = require("node:fs");
const path = require("node:path");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");

const distIndex = path.join(__dirname, "..", "web", "dist", "index.html");
const hasBuiltFrontend = fs.existsSync(distIndex);

describe("security headers", () => {
  test("sets the standard hardening headers on API responses", async () => {
    const res = await request(app).get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["content-security-policy"]);
    // helmet removes the framework fingerprint
    assert.equal(res.headers["x-powered-by"], undefined);
  });

  test("allows data: and blob: images so inline QR/label images still render", async () => {
    const res = await request(app).get("/health");
    const csp = res.headers["content-security-policy"];
    assert.match(csp, /img-src[^;]*data:/);
    assert.match(csp, /img-src[^;]*blob:/);
  });
});

describe("API 404s stay JSON", () => {
  test("an unknown path under an API prefix never falls through to the SPA HTML", async () => {
    // Whatever the status (401 from the router's authenticate, or 404), a
    // fetch() caller must get JSON it can parse — never index.html.
    const res = await request(app).get("/api/products/definitely-not-a-route/nope");
    assert.match(res.headers["content-type"], /application\/json/);
    assert.ok(!res.headers["content-type"].includes("text/html"));
  });

  test("an unknown non-GET path returns a JSON 404", async () => {
    const res = await request(app).post("/not-a-real-route").send({});
    assert.equal(res.status, 404);
    assert.match(res.headers["content-type"], /application\/json/);
  });
});

describe("SPA fallback", { skip: !hasBuiltFrontend }, () => {
  test("serves index.html for a client-side route", async () => {
    const res = await request(app).get("/pos");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
  });

  test("does not hijack API routes", async () => {
    // /sales is a real API route; without a token it must 401 as JSON rather
    // than falling through to the SPA's index.html.
    const res = await request(app).get("/api/sales");
    assert.equal(res.status, 401);
    assert.match(res.headers["content-type"], /application\/json/);
  });
});
