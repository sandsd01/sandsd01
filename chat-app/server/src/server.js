require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const { registerSocketHandlers } = require("./sockets");
const { startSyncWorker } = require("./jobs/queue");
const { processSyncJob } = require("./jobs/syncWorker");

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "http://localhost:5173" },
});

registerSocketHandlers(io);

const worker = startSyncWorker(processSyncJob, io);
worker.on("failed", (job, err) => {
  console.error(`Sync job ${job?.id} exhausted retries:`, err.message);
});

server.listen(PORT, () => {
  console.log(`Chat relay server listening on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  await worker.close();
  server.close();
});
