const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { requireMembership } = require("../middleware/groupAuth");

const router = express.Router();

// Duration presets the frontend offers — enforced here too, not just
// trusted client-side, since a request could send anything.
const MAX_DURATION_HOURS = 24 * 365; // effectively "forever" without allowing an insane/negative value through

// Best-effort, no cron job needed: every mute/unmute touches this table
// anyway, so sweeping expired rows here keeps it from accumulating dead
// entries without needing a scheduled job for a personal project.
async function cleanupExpiredMutes() {
  try {
    await pool.query("DELETE FROM chat_mutes WHERE muted_until IS NOT NULL AND muted_until < now()");
  } catch (err) {
    console.error("mute cleanup failed:", err.message);
  }
}

async function upsertMute(userId, chatKind, chatId, durationHours) {
  let mutedUntilExpr = "NULL";
  const params = [userId, chatKind, chatId];
  if (durationHours != null) {
    const hours = Math.min(Math.max(Number(durationHours), 0.01), MAX_DURATION_HOURS);
    params.push(hours);
    mutedUntilExpr = "now() + ($4 * INTERVAL '1 hour')";
  }
  const result = await pool.query(
    `INSERT INTO chat_mutes (user_id, chat_kind, chat_id, muted_until)
     VALUES ($1, $2, $3, ${mutedUntilExpr})
     ON CONFLICT (user_id, chat_kind, chat_id)
     DO UPDATE SET muted_until = EXCLUDED.muted_until, created_at = now()
     RETURNING muted_until`,
    params
  );
  return result.rows[0].muted_until;
}

// Mute a DM — durationHours in the body is optional; omit/null for "forever".
router.post("/dm/:username", requireAuth, async (req, res) => {
  cleanupExpiredMutes();
  try {
    const otherResult = await pool.query("SELECT id FROM users WHERE username = $1", [req.params.username]);
    const other = otherResult.rows[0];
    if (!other) return res.status(404).json({ error: `no user named '${req.params.username}'` });
    if (other.id === req.user.id) return res.status(400).json({ error: "you can't mute yourself" });

    const mutedUntil = await upsertMute(req.user.id, "dm", other.id, req.body?.durationHours ?? null);
    res.json({ muted: true, mutedUntil });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't mute that conversation" });
  }
});

router.delete("/dm/:username", requireAuth, async (req, res) => {
  try {
    const otherResult = await pool.query("SELECT id FROM users WHERE username = $1", [req.params.username]);
    const other = otherResult.rows[0];
    if (!other) return res.status(404).json({ error: `no user named '${req.params.username}'` });

    await pool.query("DELETE FROM chat_mutes WHERE user_id = $1 AND chat_kind = 'dm' AND chat_id = $2", [
      req.user.id,
      other.id,
    ]);
    res.json({ muted: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't unmute that conversation" });
  }
});

// Mute a group — anyone in the group can mute it for themselves (muting is
// personal, not something a member imposes on the whole group).
router.post("/group/:groupId", requireAuth, requireMembership, async (req, res) => {
  cleanupExpiredMutes();
  try {
    const mutedUntil = await upsertMute(req.user.id, "group", req.groupId, req.body?.durationHours ?? null);
    res.json({ muted: true, mutedUntil });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't mute that group" });
  }
});

router.delete("/group/:groupId", requireAuth, requireMembership, async (req, res) => {
  try {
    await pool.query("DELETE FROM chat_mutes WHERE user_id = $1 AND chat_kind = 'group' AND chat_id = $2", [
      req.user.id,
      req.groupId,
    ]);
    res.json({ muted: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't unmute that group" });
  }
});

module.exports = router;
