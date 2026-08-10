const multer = require("multer");
const path = require("path");
const { uploadDir } = require("./storage");

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

// Buffered in memory (capped at 5MB below) so `src/lib/storage.js` decides
// where the bytes actually land — local disk or object storage — rather than
// multer writing straight to a filesystem that may not survive a redeploy.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error("Unsupported image type"));
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadDir };
