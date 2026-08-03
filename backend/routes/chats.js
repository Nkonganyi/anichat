const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { requireMembership } = require("../middleware/groupAuth");

const router = express.Router();

async function resolveDmPartnerId(username) {
  const result = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
  return result.rows[0]?.id || null;
}

// ---- Archive ----
// Manual and sticky — a new incoming message does NOT auto-unarchive a
// chat. See schema.sql / the milestone README for why.

router.post("/dm/:username/archive", requireAuth, async (req, res) => {
  const otherId = await resolveDmPartnerId(req.params.username);
  if (!otherId) return res.status(404).json({ error: `no user named '${req.params.username}'` });
  try {
    await pool.query(
      `INSERT INTO chat_archives (user_id, chat_kind, chat_id) VALUES ($1, 'dm', $2)
       ON CONFLICT (user_id, chat_kind, chat_id) DO UPDATE SET archived_at = now()`,
      [req.user.id, otherId]
    );
    res.json({ archived: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't archive that conversation" });
  }
});

router.delete("/dm/:username/archive", requireAuth, async (req, res) => {
  const otherId = await resolveDmPartnerId(req.params.username);
  if (!otherId) return res.status(404).json({ error: `no user named '${req.params.username}'` });
  try {
    await pool.query("DELETE FROM chat_archives WHERE user_id = $1 AND chat_kind = 'dm' AND chat_id = $2", [
      req.user.id,
      otherId,
    ]);
    res.json({ archived: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't unarchive that conversation" });
  }
});

router.post("/group/:groupId/archive", requireAuth, requireMembership, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO chat_archives (user_id, chat_kind, chat_id) VALUES ($1, 'group', $2)
       ON CONFLICT (user_id, chat_kind, chat_id) DO UPDATE SET archived_at = now()`,
      [req.user.id, req.groupId]
    );
    res.json({ archived: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't archive that group" });
  }
});

router.delete("/group/:groupId/archive", requireAuth, requireMembership, async (req, res) => {
  try {
    await pool.query("DELETE FROM chat_archives WHERE user_id = $1 AND chat_kind = 'group' AND chat_id = $2", [
      req.user.id,
      req.groupId,
    ]);
    res.json({ archived: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't unarchive that group" });
  }
});

// ---- Delete conversation (clear-for-me) ----
// One-way — there's no "undelete." Re-running it again just moves the
// cutoff forward. This only affects the requester's own view; the other
// person's (or other members') messages are completely untouched.

router.post("/dm/:username/clear", requireAuth, async (req, res) => {
  const otherId = await resolveDmPartnerId(req.params.username);
  if (!otherId) return res.status(404).json({ error: `no user named '${req.params.username}'` });
  try {
    await pool.query(
      `INSERT INTO chat_clears (user_id, chat_kind, chat_id, cleared_before) VALUES ($1, 'dm', $2, now())
       ON CONFLICT (user_id, chat_kind, chat_id) DO UPDATE SET cleared_before = now()`,
      [req.user.id, otherId]
    );
    res.json({ cleared: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't clear that conversation" });
  }
});

router.post("/group/:groupId/clear", requireAuth, requireMembership, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO chat_clears (user_id, chat_kind, chat_id, cleared_before) VALUES ($1, 'group', $2, now())
       ON CONFLICT (user_id, chat_kind, chat_id) DO UPDATE SET cleared_before = now()`,
      [req.user.id, req.groupId]
    );
    res.json({ cleared: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't clear that group's history" });
  }
});

module.exports = router;
