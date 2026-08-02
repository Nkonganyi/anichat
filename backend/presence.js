// Presence (online / last seen) — Milestone 18.
//
// "Online right now" is tracked purely in memory (a user can have several
// open sockets — multiple tabs/devices — so we count active sockets per
// user, not just track a boolean). It's only considered "offline" once
// every one of their sockets has disconnected. That transition is the only
// moment we touch the database, writing last_seen_at — matching the
// WhatsApp/Telegram convention of "Last seen" only updating when someone
// actually leaves, not every time they blink.
//
// Presence updates are only broadcast to a user's "audience" — people who
// already share a DM history or a group with them — rather than globally,
// since AniChat has no public friend list and blasting every presence
// change to every user on the server would be both wasteful and a privacy
// leak (letting anyone snoop on anyone else's online status).

const pool = require("./db/pool");

const onlineSockets = new Map(); // userId -> Set<socketId>

function isOnline(userId) {
  const set = onlineSockets.get(userId);
  return !!set && set.size > 0;
}

async function getAudience(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT peer_id FROM (
       SELECT CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS peer_id
       FROM messages WHERE sender_id = $1 OR receiver_id = $1
       UNION
       SELECT gm2.user_id AS peer_id
       FROM group_members gm1
       JOIN group_members gm2 ON gm2.group_id = gm1.group_id AND gm2.user_id != $1
       WHERE gm1.user_id = $1
     ) audience`,
    [userId]
  );
  return rows.map((r) => r.peer_id);
}

// emitToUser is passed in (rather than required directly) purely to dodge
// having to think about module load order between this file and realtime.js;
// in practice callers always pass require("../realtime").emitToUser.
async function handleSocketConnect(userId, socketId, emitToUser) {
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  const set = onlineSockets.get(userId);
  const wasOffline = set.size === 0;
  set.add(socketId);

  if (wasOffline) {
    const audience = await getAudience(userId);
    audience.forEach((peerId) => emitToUser(peerId, "presence:update", { userId, online: true, lastSeenAt: null }));
  }
}

async function handleSocketDisconnect(userId, socketId, emitToUser) {
  const set = onlineSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size > 0) return; // still has other active sockets — stays "online"

  onlineSockets.delete(userId);
  try {
    const result = await pool.query("UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at", [
      userId,
    ]);
    const lastSeenAt = result.rows[0]?.last_seen_at || null;
    const audience = await getAudience(userId);
    audience.forEach((peerId) => emitToUser(peerId, "presence:update", { userId, online: false, lastSeenAt }));
  } catch (err) {
    console.error("presence: failed to record last_seen_at:", err.message);
  }
}

module.exports = { isOnline, handleSocketConnect, handleSocketDisconnect };
