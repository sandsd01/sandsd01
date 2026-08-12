const { pool } = require("../lib/db");
const { decrypt } = require("../lib/crypto");
const { getFreshAccessToken } = require("../services/googleAuth");
const { appendMessageToTranscript, shareFileReadOnly } = require("../services/drive");

async function syncMessageToUser({ user, otherUser, conversationId, message }) {
  const refreshToken = decrypt(user.refresh_token_encrypted);
  const credentials = await getFreshAccessToken(refreshToken);

  if (message.type === "file" && message.driveFileId && message.senderId !== user.id) {
    try {
      await shareFileReadOnly(credentials.access_token, message.driveFileId, user.email);
    } catch (err) {
      // Sharing can race with Drive's own indexing right after upload; the
      // transcript write below is what matters for durability, so don't fail the job over it.
      console.warn(`Could not auto-share file ${message.driveFileId} with ${user.email}:`, err.message);
    }
  }

  return appendMessageToTranscript({
    accessToken: credentials.access_token,
    rootFolderId: user.drive_folder_id,
    conversationId,
    participants: [user.email, otherUser.email],
    message,
  });
}

function notify(io, userId, messageId, status) {
  io.to(`user:${userId}`).emit("sync:status", { messageId, status });
}

// Runs once per queued message (see jobs/queue.js). Writes to BOTH
// participants' Drives; if either side fails (expired/revoked token, Drive
// outage) the job throws so BullMQ retries with backoff — already-synced
// sides are cheap idempotent no-ops on the next attempt since they just
// append the same message id again... so we gate re-append with the
// synced_to_a/b flags instead of re-running a side that already succeeded.
async function processSyncJob(job, io) {
  const { syncId, conversationId, message } = job.data;

  const { rows: syncRows } = await pool.query("SELECT * FROM pending_sync_messages WHERE id = $1", [syncId]);
  const syncRow = syncRows[0];
  if (!syncRow) return;

  const { rows: convRows } = await pool.query("SELECT * FROM conversations WHERE id = $1", [conversationId]);
  const conversation = convRows[0];
  if (!conversation) return;

  const { rows: userRows } = await pool.query("SELECT * FROM users WHERE id = ANY($1::uuid[])", [
    [conversation.user_a_id, conversation.user_b_id],
  ]);
  const userA = userRows.find((u) => u.id === conversation.user_a_id);
  const userB = userRows.find((u) => u.id === conversation.user_b_id);
  if (!userA || !userB) return;

  let failure = null;

  if (!syncRow.synced_to_a) {
    try {
      const fileId = await syncMessageToUser({ user: userA, otherUser: userB, conversationId, message });
      await pool.query(
        "UPDATE pending_sync_messages SET synced_to_a = true WHERE id = $1",
        [syncId]
      );
      await pool.query(
        "UPDATE conversations SET user_a_drive_file_id = $1 WHERE id = $2",
        [fileId, conversationId]
      );
      notify(io, userA.id, message.id, "synced");
    } catch (err) {
      failure = err;
      console.error(`Drive sync failed for user A (${userA.email}):`, err.message);
      notify(io, userA.id, message.id, "failed");
    }
  }

  if (!syncRow.synced_to_b) {
    try {
      const fileId = await syncMessageToUser({ user: userB, otherUser: userA, conversationId, message });
      await pool.query(
        "UPDATE pending_sync_messages SET synced_to_b = true WHERE id = $1",
        [syncId]
      );
      await pool.query(
        "UPDATE conversations SET user_b_drive_file_id = $1 WHERE id = $2",
        [fileId, conversationId]
      );
      notify(io, userB.id, message.id, "synced");
    } catch (err) {
      failure = err;
      console.error(`Drive sync failed for user B (${userB.email}):`, err.message);
      notify(io, userB.id, message.id, "failed");
    }
  }

  if (failure) throw failure;
}

module.exports = { processSyncJob };
