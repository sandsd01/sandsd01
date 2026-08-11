const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

let connection;
let queue;

function getConnection() {
  if (!connection) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set");
    connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

function getQueue() {
  if (!queue) {
    queue = new Queue("drive-sync", { connection: getConnection() });
  }
  return queue;
}

// One job per message, fanned out to both participants' Drives inside the
// processor (see jobs/syncWorker.js). Exponential backoff covers the
// "token expired / revoked" case from spec section 6/10 until BullMQ gives up.
async function enqueueMessageSync(data) {
  await getQueue().add("sync-message", data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  });
}

function startSyncWorker(processor, io) {
  return new Worker("drive-sync", (job) => processor(job, io), { connection: getConnection() });
}

module.exports = { getQueue, enqueueMessageSync, startSyncWorker, getConnection };
