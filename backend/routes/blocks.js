const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/:username", requireAuth, async (req, res) => {
  try {
    const otherResult = await pool.query("SELECT id FROM users WHERE username = $1", [req.params.username]);
    const other = otherResult.rows[0];
    if (!other) return res.status(404).json({ error: `no user named '${req.params.username}'` });
    if (other.id === req.user.id) return res.status(400).json({ error: "you can't block yourself" });

    await pool.query(
      "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [req.user.id, other.id]
    );
    res.json({ blocked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't block that user" });
  }
});

router.delete("/:username", requireAuth, async (req, res) => {
  try {
    const otherResult = await pool.query("SELECT id FROM users WHERE username = $1", [req.params.username]);
    const other = otherResult.rows[0];
    if (!other) return res.status(404).json({ error: `no user named '${req.params.username}'` });

    await pool.query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [req.user.id, other.id]);
    res.json({ blocked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't unblock that user" });
  }
});

// List everyone I've blocked — for a "Blocked users" settings view.
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.username, u.avatar, ub.created_at AS blocked_at
       FROM user_blocks ub
       JOIN users u ON u.id = ub.blocked_id
       WHERE ub.blocker_id = $1
       ORDER BY ub.created_at DESC`,
      [req.user.id]
    );
    res.json({ blocked: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load your blocked users" });
  }
});

module.exports = router;
