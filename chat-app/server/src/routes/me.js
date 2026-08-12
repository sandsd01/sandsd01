const express = require("express");
const { pool } = require("../lib/db");
const { decrypt } = require("../lib/crypto");
const { getFreshAccessToken } = require("../services/googleAuth");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, email, display_name, avatar_url, is_online, last_seen_at FROM users WHERE id = $1",
    [req.user.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "User not found" });
  const u = rows[0];
  res.json({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    isOnline: u.is_online,
    lastSeenAt: u.last_seen_at,
  });
});

// Short-lived Google access token so the browser can upload attachments
// straight to the user's own Drive (spec section 7) without proxying bytes
// through this server. Not in the spec's endpoint table but required by it.
router.get("/drive-token", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT refresh_token_encrypted, drive_folder_id FROM users WHERE id = $1",
    [req.user.id]
  );
  if (rows.length === 0 || !rows[0].refresh_token_encrypted) {
    return res.status(409).json({ error: "Google Drive is not connected for this account. Please sign in again." });
  }
  try {
    const refreshToken = decrypt(rows[0].refresh_token_encrypted);
    const credentials = await getFreshAccessToken(refreshToken);
    res.json({
      accessToken: credentials.access_token,
      expiresAt: credentials.expiry_date,
      driveFolderId: rows[0].drive_folder_id,
    });
  } catch (err) {
    console.error("Failed to refresh Google access token:", err);
    res.status(409).json({ error: "Google Drive access has expired or been revoked. Please reconnect your account." });
  }
});

module.exports = router;
