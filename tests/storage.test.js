const fs = require("node:fs");
const path = require("node:path");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { saveUpload, deleteUpload, uploadDir, isRemote } = require("../src/lib/storage");

// These cover the local-disk driver, which is what runs in dev and in tests.
// The S3 driver shares the same interface; it is selected purely by S3_BUCKET
// being set, and is exercised against a real bucket rather than mocked here.
describe("upload storage (local driver)", () => {
  test("defaults to the local driver when S3_BUCKET is unset", () => {
    assert.equal(isRemote, false);
  });

  test("saves a file and returns a /uploads URL pointing at real bytes", async () => {
    const buffer = Buffer.from("fake-image-bytes");
    const url = await saveUpload({ buffer, originalName: "photo.png", prefix: "product-1" });

    assert.match(url, /^\/uploads\/product-1-\d+-[0-9a-f]{8}\.png$/);
    const onDisk = path.join(uploadDir, url.split("/").pop());
    assert.equal(fs.readFileSync(onDisk).toString(), "fake-image-bytes");

    await deleteUpload(url);
    assert.equal(fs.existsSync(onDisk), false);
  });

  test("two uploads in the same millisecond do not collide", async () => {
    const buffer = Buffer.from("x");
    const [a, b] = await Promise.all([
      saveUpload({ buffer, originalName: "a.png", prefix: "product-9" }),
      saveUpload({ buffer, originalName: "a.png", prefix: "product-9" }),
    ]);
    assert.notEqual(a, b);

    await deleteUpload(a);
    await deleteUpload(b);
  });

  test("deleting a missing or empty upload is a no-op rather than throwing", async () => {
    await deleteUpload("/uploads/does-not-exist.png");
    await deleteUpload(null);
    await deleteUpload("");
  });
});
