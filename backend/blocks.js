// Block checking — Milestone 21.
//
// Blocking is directional in storage (who blocked whom) but symmetric in
// effect: while a block exists in either direction, neither person can
// message the other. That's the simplest mental model and matches how
// blocking behaves in most chat apps — you don't get to keep messaging
// someone who blocked you just because you didn't block them back.
//
// Scoped to DMs only. Groups are untouched — see this milestone's README
// entry for why.

const pool = require("./db/pool");

async function isBlockedEitherWay(userAId, userBId) {
  const result = await pool.query(
    "SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1",
    [userAId, userBId]
  );
  return result.rows.length > 0;
}

// Which direction, specifically — used for UI purposes (e.g. "you blocked
// them" vs "they blocked you" read differently even though messaging is
// blocked either way).
async function getBlockStatus(userAId, userBId) {
  const result = await pool.query(
    "SELECT blocker_id, blocked_id FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)",
    [userAId, userBId]
  );
  const blockedByMe = result.rows.some((r) => r.blocker_id === userAId);
  const blockedMe = result.rows.some((r) => r.blocker_id === userBId);
  return { blockedByMe, blockedMe, blocked: blockedByMe || blockedMe };
}

module.exports = { isBlockedEitherWay, getBlockStatus };
