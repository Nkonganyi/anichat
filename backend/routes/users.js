const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Keep these lists in sync with the frontend (avatars.js / themes.js) —
// this is the server-side source of truth for valid ids.
const VALID_AVATARS = [
  "sakura", "moonlight", "ember", "frost", "starlight",
  "shadow", "storm", "bloom", "nova", "twilight",
];

const VALID_THEMES = ["voyage", "requiem", "shadow-leaf"];

router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, avatar, theme, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "user not found" });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load your profile" });
  }
});

router.patch("/me", requireAuth, async (req, res) => {
  const { avatar, theme } = req.body;

  if (avatar === undefined && theme === undefined) {
    return res.status(400).json({ error: "provide 'avatar' and/or 'theme' to update" });
  }
  if (avatar !== undefined && !VALID_AVATARS.includes(avatar)) {
    return res.status(400).json({ error: `avatar must be one of: ${VALID_AVATARS.join(", ")}` });
  }
  if (theme !== undefined && !VALID_THEMES.includes(theme)) {
    return res.status(400).json({ error: `theme must be one of: ${VALID_THEMES.join(", ")}` });
  }

  try {
    const current = await pool.query("SELECT avatar, theme FROM users WHERE id = $1", [req.user.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "user not found" });
    }

    const nextAvatar = avatar !== undefined ? avatar : current.rows[0].avatar;
    const nextTheme = theme !== undefined ? theme : current.rows[0].theme;

    const result = await pool.query(
      "UPDATE users SET avatar = $1, theme = $2 WHERE id = $3 RETURNING id, username, avatar, theme, created_at",
      [nextAvatar, nextTheme, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't update your profile" });
  }
});

module.exports = router;
