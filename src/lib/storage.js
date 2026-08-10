const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Uploaded images (product photos, branch PromptPay QR codes) live on local
// disk by default, which is fine for development but wrong for most hosting:
// container filesystems are ephemeral, so a redeploy silently loses every
// image. Setting the S3_* variables switches to any S3-compatible object
// store (AWS S3, Cloudflare R2, MinIO, Spaces…) so uploads outlive the
// container.

const uploadDir = path.join(__dirname, "../../uploads");

const s3Bucket = process.env.S3_BUCKET;
const isRemote = Boolean(s3Bucket);

let s3Client = null;
let S3Commands = null;

if (isRemote) {
  // Required so the browser can actually load the images: without a public
  // base URL we would have no addressable URL to store on the record.
  if (!process.env.S3_PUBLIC_BASE_URL) {
    throw new Error("S3_PUBLIC_BASE_URL is required when S3_BUCKET is set");
  }
  // eslint-disable-next-line global-require
  const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
  S3Commands = { PutObjectCommand, DeleteObjectCommand };
  s3Client = new S3Client({
    region: process.env.S3_REGION || "auto",
    // R2/MinIO need an explicit endpoint; plain AWS S3 does not.
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
} else {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const publicBaseUrl = (process.env.S3_PUBLIC_BASE_URL || "").replace(/\/$/, "");

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function buildKey(prefix, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  // Random suffix rather than a bare timestamp: two uploads in the same
  // millisecond would otherwise overwrite each other.
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
}

/**
 * Persists an uploaded file and returns the URL to store on the record —
 * a `/uploads/...` path locally, or an absolute URL when using object storage.
 */
async function saveUpload({ buffer, originalName, prefix }) {
  const key = buildKey(prefix, originalName);
  const ext = path.extname(key).toLowerCase();

  if (!isRemote) {
    await fs.promises.writeFile(path.join(uploadDir, key), buffer);
    return `/uploads/${key}`;
  }

  await s3Client.send(
    new S3Commands.PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: CONTENT_TYPES[ext] || "application/octet-stream",
    })
  );
  return `${publicBaseUrl}/${key}`;
}

/**
 * Best-effort removal of a previously saved upload. Never throws: failing to
 * delete an old image must not fail the request that replaced it, and the
 * record has already moved on to the new URL either way.
 */
async function deleteUpload(url) {
  if (!url) return;
  const key = url.split("/").pop();
  if (!key) return;

  try {
    if (!isRemote) {
      await fs.promises.unlink(path.join(uploadDir, key));
      return;
    }
    await s3Client.send(
      new S3Commands.DeleteObjectCommand({ Bucket: s3Bucket, Key: key })
    );
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    console.error("Failed to delete upload:", url, err.message);
  }
}

module.exports = { saveUpload, deleteUpload, uploadDir, isRemote, publicBaseUrl };
