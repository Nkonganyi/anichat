let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function emitToUser(userId, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit(event, payload);
}

function emitToGroup(groupId, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(`group:${groupId}`).emit(event, payload);
}

// Makes every live socket a user currently has open join a group's room —
// used right after they're added to a group so they start receiving
// that group's messages immediately, no reconnect needed.
async function joinUserToGroupRoom(userId, groupId) {
  if (!ioInstance) return;
  await ioInstance.in(`user:${userId}`).socketsJoin(`group:${groupId}`);
}

async function removeUserFromGroupRoom(userId, groupId) {
  if (!ioInstance) return;
  await ioInstance.in(`user:${userId}`).socketsLeave(`group:${groupId}`);
}

// Emits to a user and waits (up to timeoutMs) for at least one of their
// connected clients to acknowledge receipt — this is what "delivered"
// actually means, as opposed to "sent" (just saved to the DB). If they're
// offline or don't ack in time, returns false and the message stays "sent".
async function emitToUserWithAck(userId, event, payload, timeoutMs = 4000) {
  if (!ioInstance) return false;
  try {
    const responses = await ioInstance.timeout(timeoutMs).to(`user:${userId}`).emitWithAck(event, payload);
    return Array.isArray(responses) && responses.length > 0;
  } catch {
    // emitWithAck rejects on timeout (nobody acked in time) — that's a
    // normal "not delivered yet" outcome, not an error condition.
    return false;
  }
}

module.exports = { setIO, emitToUser, emitToGroup, joinUserToGroupRoom, removeUserFromGroupRoom, emitToUserWithAck };
