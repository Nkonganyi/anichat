const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const dmResult = await pool.query(
      `SELECT s.message_id, s.starred_at,
              m.content, m.type, m.deleted_at, m.created_at,
              su.username AS sender_username,
              CASE WHEN m.sender_id = $1 THEN ru.username ELSE su.username END AS conversation_partner
       FROM starred_messages s
       JOIN messages m ON m.id = s.message_id
       JOIN users su ON su.id = m.sender_id
       JOIN users ru ON ru.id = m.receiver_id
       WHERE s.user_id = $1 AND s.message_kind = 'dm'
       ORDER BY s.starred_at DESC`,
      [req.user.id]
    );

    const groupResult = await pool.query(
      `SELECT s.message_id, s.starred_at,
              gm.content, gm.type, gm.deleted_at, gm.created_at,
              su.username AS sender_username, g.id AS group_id, g.name AS group_name
       FROM starred_messages s
       JOIN group_messages gm ON gm.id = s.message_id
       JOIN users su ON su.id = gm.sender_id
       JOIN groups g ON g.id = gm.group_id
       WHERE s.user_id = $1 AND s.message_kind = 'group'
       ORDER BY s.starred_at DESC`,
      [req.user.id]
    );

    const starred = [
      ...dmResult.rows.map((row) => ({
        kind: "dm",
        messageId: row.message_id,
        starredAt: row.starred_at,
        content: row.deleted_at ? null : row.content,
        deleted: !!row.deleted_at,
        type: row.type,
        senderUsername: row.sender_username,
        conversationLabel: row.conversation_partner,
        createdAt: row.created_at,
      })),
      ...groupResult.rows.map((row) => ({
        kind: "group",
        messageId: row.message_id,
        groupId: row.group_id,
        starredAt: row.starred_at,
        content: row.deleted_at ? null : row.content,
        deleted: !!row.deleted_at,
        type: row.type,
        senderUsername: row.sender_username,
        conversationLabel: row.group_name,
        createdAt: row.created_at,
      })),
    ].sort((a, b) => new Date(b.starredAt) - new Date(a.starredAt));

    res.json({ starred });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load starred messages" });
  }
});

module.exports = router;
