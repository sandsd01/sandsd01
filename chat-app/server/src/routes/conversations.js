const express = require("express");
const { pool } = require("../lib/db");
const { authenticate } = require("../middleware/auth");
const { decrypt } = require("../lib/crypto");
const { getFreshAccessToken, driveClientFromAccessToken } = require("../services/googleAuth");

const router = express.Router();
router.use(authenticate);

router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, ua.email AS user_a_email, ua.display_name AS user_a_name, ua.avatar_url AS user_a_avatar,
            ub.email AS user_b_email, ub.display_name AS user_b_name, ub.avatar_url AS user_b_avatar
     FROM conversations c
     JOIN users ua ON ua.id = c.user_a_id
     JOIN users ub ON ub.id = c.user_b_id
     WHERE c.user_a_id = $1 OR c.user_b_id = $1
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
    [req.user.id]
  );

  const conversations = rows.map((c) => {
    const isUserA = c.user_a_id === req.user.id;
    return {
      id: c.id,
      otherUser: {
        id: isUserA ? c.user_b_id : c.user_a_id,
        email: isUserA ? c.user_b_email : c.user_a_email,
        displayName: isUserA ? c.user_b_name : c.user_a_name,
        avatarUrl: isUserA ? c.user_b_avatar : c.user_a_avatar,
      },
      lastMessagePreview: c.last_message_preview,
      lastMessageAt: c.last_message_at,
      createdAt: c.created_at,
    };
  });

  res.json(conversations);
});

router.post("/", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });
  const normalizedEmail = email.toLowerCase();
  if (normalizedEmail === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: "Cannot start a conversation with yourself" });
  }

  const { rows: otherRows } = await pool.query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
  if (otherRows.length === 0) {
    return res.status(404).json({ error: "No user found with that email. They need to sign in at least once first." });
  }
  const other = otherRows[0];

  // conversations.user_a_id < user_b_id is a DB constraint (see schema.sql);
  // sorting here keeps the pair canonical so the UNIQUE constraint actually dedupes.
  const [userAId, userBId] = [req.user.id, other.id].sort();

  const { rows: existing } = await pool.query(
    "SELECT id FROM conversations WHERE user_a_id = $1 AND user_b_id = $2",
    [userAId, userBId]
  );
  if (existing.length > 0) {
    return res.json({ id: existing[0].id });
  }

  const { rows } = await pool.query(
    "INSERT INTO conversations (user_a_id, user_b_id) VALUES ($1, $2) RETURNING id",
    [userAId, userBId]
  );
  res.status(201).json({ id: rows[0].id });
});

router.get("/:id/history", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM conversations WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Conversation not found" });
  const conversation = rows[0];

  if (conversation.user_a_id !== req.user.id && conversation.user_b_id !== req.user.id) {
    return res.status(403).json({ error: "Not a participant in this conversation" });
  }

  const isUserA = conversation.user_a_id === req.user.id;
  const driveFileId = isUserA ? conversation.user_a_drive_file_id : conversation.user_b_drive_file_id;

  if (!driveFileId) {
    return res.json({ conversationId: conversation.id, participants: [], messages: [] });
  }

  try {
    const { rows: userRows } = await pool.query(
      "SELECT refresh_token_encrypted FROM users WHERE id = $1",
      [req.user.id]
    );
    const refreshToken = decrypt(userRows[0].refresh_token_encrypted);
    const credentials = await getFreshAccessToken(refreshToken);
    const drive = driveClientFromAccessToken(credentials.access_token);

    const { data } = await drive.files.get({ fileId: driveFileId, alt: "media" });
    const transcript = typeof data === "string" ? JSON.parse(data) : data;
    res.json(transcript);
  } catch (err) {
    console.error(`Failed to load history from Drive for conversation ${conversation.id}:`, err);
    res.status(502).json({ error: "Could not load history from Google Drive. Try reconnecting your account." });
  }
});

module.exports = router;
