const database = require('../database/connection');

async function recordAuditEvent({
  actorId = null,
  action,
  entityType,
  entityId = null,
  metadata = null,
  ipAddress = null,
}) {
  try {
    await database.promise().query(
      `INSERT INTO audit_events
        (actor_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actorId,
        action,
        entityType,
        entityId === null ? null : String(entityId),
        metadata ? JSON.stringify(metadata) : null,
        ipAddress,
      ],
    );
  } catch (error) {
    console.error('Unable to record audit event:', error.message);
  }
}

module.exports = { recordAuditEvent };
