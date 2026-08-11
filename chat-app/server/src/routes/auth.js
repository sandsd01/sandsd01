const express = require("express");
const jwt = require("jsonwebtoken");
const { pool } = require("../lib/db");
const { encrypt } = require("../lib/crypto");
const { exchangeCodeForTokens, getAuthUrl } = require("../services/googleAuth");
const { ensureAppFolders } = require("../services/drive");

const router = express.Router();

router.get("/google/url", (req, res) => {
  res.json({ url: getAuthUrl() });
});

router.post("/google/callback", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code is required" });

  try {
    const { tokens, profile } = await exchangeCodeForTokens(code);
    const rootFolderId = await ensureAppFolders(tokens.access_token);

    const existing = await pool.query("SELECT * FROM users WHERE google_id = $1", [profile.id]);

    let user;
    if (existing.rows.length > 0) {
      const updates = ["display_name = $1", "avatar_url = $2", "drive_folder_id = $3"];
      const values = [profile.name, profile.picture, rootFolderId];
      if (tokens.refresh_token) {
        updates.push(`refresh_token_encrypted = $${values.length + 1}`);
        values.push(encrypt(tokens.refresh_token));
      }
      values.push(profile.id);
      const { rows } = await pool.query(
        `UPDATE users SET ${updates.join(", ")} WHERE google_id = $${values.length} RETURNING *`,
        values
      );
      user = rows[0];
    } else {
      if (!tokens.refresh_token) {
        // First-time sign-in should always include a refresh_token because we
        // request prompt=consent; if it's missing something is misconfigured
        // upstream (e.g. the OAuth client isn't set to "offline" access).
        return res.status(400).json({
          error:
            "Google did not return a refresh token. Revoke access at https://myaccount.google.com/permissions and try signing in again.",
        });
      }
      const { rows } = await pool.query(
        `INSERT INTO users (google_id, email, display_name, avatar_url, drive_folder_id, refresh_token_encrypted)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [profile.id, profile.email, profile.name, profile.picture, rootFolderId, encrypt(tokens.refresh_token)]
      );
      user = rows[0];
    }

    const appToken = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token: appToken,
      user: { id: user.id, email: user.email, displayName: user.display_name, avatarUrl: user.avatar_url },
    });
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
    res.status(500).json({ error: "Google sign-in failed" });
  }
});

module.exports = router;
