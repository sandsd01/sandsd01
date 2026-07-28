const prisma = require("../../prisma/client");

async function logAction({ userId, action, entityType, entityId, details }) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId: entityId ?? null,
      details: details ? JSON.stringify(details) : null,
    },
  });
}

module.exports = { logAction };
