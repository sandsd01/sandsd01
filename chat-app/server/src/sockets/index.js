const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { pool } = require("../lib/db");
const { enqueueMessageSync } = require("../jobs/queue");

function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Missing auth token"));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = payload.sub;
    socket.userEmail = payload.email;
    next();
  } catch {
    next(new Error("Invalid auth token"));
  }
}

function registerSocketHandlers(io) {
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    handleConnect(io, socket);

    socket.on("message:send", (payload) => handleMessageSend(io, socket, payload));
    socket.on("presence:online", () => markOnline(io, socket.userId, true));
    socket.on("disconnect", () => handleDisconnect(io, socket));
  });
}

async function handleConnect(io, socket) {
  // Every tab/device for a user joins the same room, so a message reaches all
  // of that user's open sessions and "online" only flips to false once none remain.
  socket.join(`user:${socket.userId}`);
  await markOnline(io, socket.userId, true);
}

async function handleDisconnect(io, socket) {
  const remainingSockets = await io.in(`user:${socket.userId}`).fetchSockets();
  if (remainingSockets.length === 0) {
    await markOnline(io, socket.userId, false);
  }
}

async function markOnline(io, userId, isOnline) {
  await pool.query("UPDATE users SET is_online = $1, last_seen_at = now() WHERE id = $2", [isOnline, userId]);
  io.emit("presence:update", { userId, isOnline });
}

async function handleMessageSend(io, socket, payload) {
  const { conversationId, content, type = "text", fileName, driveFileId, shareLink } = payload || {};
  if (!conversationId || (type === "text" && !content) || (type === "file" && !driveFileId)) {
    socket.emit("sync:status", { status: "failed", error: "Invalid message payload" });
    return;
  }

  const { rows } = await pool.query("SELECT * FROM conversations WHERE id = $1", [conversationId]);
  const conversation = rows[0];
  if (!conversation || (conversation.user_a_id !== socket.userId && conversation.user_b_id !== socket.userId)) {
    socket.emit("sync:status", { status: "failed", error: "Not a participant in this conversation" });
    return;
  }

  const message = {
    id: crypto.randomUUID(),
    conversationId,
    senderId: socket.userId,
    type,
    content: type === "text" ? content : undefined,
    fileName: type === "file" ? fileName : undefined,
    driveFileId: type === "file" ? driveFileId : undefined,
    shareLink: type === "file" ? shareLink : undefined,
    timestamp: new Date().toISOString(),
  };

  const { rows: inserted } = await pool.query(
    `INSERT INTO pending_sync_messages (conversation_id, sender_id, content, message_type, file_drive_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [conversationId, socket.userId, type === "text" ? content : fileName, type, driveFileId || null]
  );

  const preview = type === "text" ? content : `📎 ${fileName}`;
  await pool.query("UPDATE conversations SET last_message_preview = $1, last_message_at = now() WHERE id = $2", [
    preview,
    conversationId,
  ]);

  const otherUserId = conversation.user_a_id === socket.userId ? conversation.user_b_id : conversation.user_a_id;
  // Echo to the sender's own room too, so their other open tabs/devices see it.
  io.to(`user:${otherUserId}`).to(`user:${socket.userId}`).emit("message:receive", { conversationId, message });

  await enqueueMessageSync({ syncId: inserted[0].id, conversationId, message });
}

module.exports = { registerSocketHandlers };
