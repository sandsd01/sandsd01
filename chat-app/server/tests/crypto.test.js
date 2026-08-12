const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ENCRYPTION_KEY = "0".repeat(64);
const { encrypt, decrypt } = require("../src/lib/crypto");

test("encrypt/decrypt round-trips a refresh token", () => {
  const plaintext = "1//0abcDEFghiJKLmnoPQRSTUVwxyz-refresh-token";
  const encrypted = encrypt(plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decrypt(encrypted), plaintext);
});

test("encrypt output differs across calls for the same input (random IV)", () => {
  const a = encrypt("same-input");
  const b = encrypt("same-input");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "same-input");
  assert.equal(decrypt(b), "same-input");
});

test("decrypt rejects tampered ciphertext", () => {
  const encrypted = encrypt("sensitive-token");
  const [iv, tag] = encrypted.split(".");
  const tampered = [iv, tag, Buffer.from("tampered-garbage").toString("base64")].join(".");
  assert.throws(() => decrypt(tampered));
});

test("encrypt throws when ENCRYPTION_KEY is the wrong length", () => {
  const original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "tooshort";
  try {
    assert.throws(() => encrypt("x"), /32-byte/);
  } finally {
    process.env.ENCRYPTION_KEY = original;
  }
});

test("encrypt throws when ENCRYPTION_KEY is unset", () => {
  const original = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  try {
    assert.throws(() => encrypt("x"), /ENCRYPTION_KEY is not set/);
  } finally {
    process.env.ENCRYPTION_KEY = original;
  }
});
