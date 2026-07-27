const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { emitToUser, emitToUserWithAck, emitToGroup } = require("../realtime");

const router = express.Router();

const VALID_TYPES = ["text", "sticker", "gif"];

// Send a message to another user (by username)
router.post("/", requireAuth, async (req, res) => {
  const { to, content, type = "text", replyToId } = req.body;

  if (!to || !content || !content.trim()) {
    return res.status(400).json({ error: "'to' (username) and 'content' are required" });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
  }

  try {
    const receiverResult = await pool.query("SELECT id FROM users WHERE username = $1", [to]);
    const receiver = receiverResult.rows[0];
    if (!receiver) {
      return res.status(404).json({ error: `no user named '${to}'` });
    }
    if (receiver.id === req.user.id) {
      return res.status(400).json({ error: "you can't message yourself" });
    }

    let replyTo = null;
    if (replyToId) {
      const rq = await pool.query(
        `SELECT rq.id, rq.type, rq.deleted_at,
                CASE WHEN rq.deleted_at IS NULL THEN rq.content ELSE NULL END AS content,
                u.username AS sender_username
         FROM messages rq
         JOIN users u ON u.id = rq.sender_id
         WHERE rq.id = $1
           AND ((rq.sender_id = $2 AND rq.receiver_id = $3) OR (rq.sender_id = $3 AND rq.receiver_id = $2))`,
        [replyToId, req.user.id, receiver.id]
      );
      if (rq.rows.length === 0) {
        return res.status(400).json({ error: "the message you're replying to isn't in this conversation" });
      }
      const r = rq.rows[0];
      replyTo = { id: r.id, type: r.type, content: r.content, deleted: !!r.deleted_at, senderUsername: r.sender_username };
    }

    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content, type, reply_to_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sender_id, receiver_id, content, type, reply_to_id, delivered_at, created_at`,
      [req.user.id, receiver.id, content.trim(), type, replyTo?.id || null]
    );

    const message = { ...result.rows[0], replyTo };

    // Push the new message live to both people — whichever tabs/devices
    // they have open. The REST response below still confirms it saved,
    // in case the sender's own socket connection is momentarily down.
    emitToUser(receiver.id, "message:new", message);
    emitToUser(req.user.id, "message:new", message);

    res.status(201).json(message);

    // "Delivered" is a real signal, not decoration: it means the recipient's
    // client actually acknowledged receiving it, not just that we tried to
    // send it. This runs after responding so it doesn't add latency to send.
    emitToUserWithAck(receiver.id, "message:new", message)
      .then(async (delivered) => {
        if (!delivered) return;
        const updateResult = await pool.query(
          "UPDATE messages SET delivered_at = now() WHERE id = $1 RETURNING delivered_at",
          [message.id]
        );
        emitToUser(req.user.id, "message:delivered", {
          messageId: message.id,
          deliveredAt: updateResult.rows[0].delivered_at,
        });
      })
      .catch((err) => console.error("delivery ack failed:", err.message));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't send that message" });
  }
});

// Get the full conversation between the logged-in user and :username
router.get("/with/:username", requireAuth, async (req, res) => {
  try {
    const otherResult = await pool.query("SELECT id, username, avatar FROM users WHERE username = $1", [
      req.params.username,
    ]);
    const other = otherResult.rows[0];
    if (!other) {
      return res.status(404).json({ error: `no user named '${req.params.username}'` });
    }

    const result = await pool.query(
      `SELECT m.id, m.sender_id, m.receiver_id, m.type, m.edited_at, m.deleted_at, m.delivered_at,
              m.pinned_at, m.forwarded_from_username, m.created_at,
              CASE WHEN m.deleted_at IS NULL THEN m.content ELSE NULL END AS content,
              rq.id AS reply_id, rq.type AS reply_type, rq.deleted_at AS reply_deleted_at,
              CASE WHEN rq.deleted_at IS NULL THEN rq.content ELSE NULL END AS reply_content,
              ru.username AS reply_sender_username,
              s.user_id IS NOT NULL AS starred_by_me
       FROM messages m
       LEFT JOIN hidden_messages h ON h.message_kind = 'dm' AND h.message_id = m.id AND h.user_id = $1
       LEFT JOIN messages rq ON rq.id = m.reply_to_id
       LEFT JOIN users ru ON ru.id = rq.sender_id
       LEFT JOIN starred_messages s ON s.message_kind = 'dm' AND s.message_id = m.id AND s.user_id = $1
       WHERE ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1))
         AND h.message_id IS NULL
       ORDER BY m.created_at ASC`,
      [req.user.id, other.id]
    );

    const messages = result.rows.map((row) => ({
      id: row.id,
      sender_id: row.sender_id,
      receiver_id: row.receiver_id,
      type: row.type,
      content: row.content,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
      delivered_at: row.delivered_at,
      pinned_at: row.pinned_at,
      forwarded_from_username: row.forwarded_from_username,
      starred_by_me: row.starred_by_me,
      created_at: row.created_at,
      replyTo: row.reply_id
        ? {
            id: row.reply_id,
            type: row.reply_type,
            content: row.reply_content,
            deleted: !!row.reply_deleted_at,
            senderUsername: row.reply_sender_username,
          }
        : null,
    }));

    if (messages.length > 0) {
      const reactionsResult = await pool.query(
        `SELECT message_id, emoji, COUNT(*)::int AS count, ARRAY_AGG(user_id) AS user_ids
         FROM message_reactions
         WHERE message_kind = 'dm' AND message_id = ANY($1::int[])
         GROUP BY message_id, emoji`,
        [messages.map((m) => m.id)]
      );
      const reactionsByMessage = new Map();
      for (const r of reactionsResult.rows) {
        if (!reactionsByMessage.has(r.message_id)) reactionsByMessage.set(r.message_id, []);
        reactionsByMessage.get(r.message_id).push({ emoji: r.emoji, count: r.count, userIds: r.user_ids });
      }
      for (const m of messages) {
        m.reactions = reactionsByMessage.get(m.id) || [];
      }
    }

    // The other person's last_read_at tells the client which of MY sent
    // messages they've actually read — powers the read-receipt ticks.
    const readResult = await pool.query(
      `SELECT last_read_at FROM conversation_reads
       WHERE user_id = $1 AND conversation_type = 'dm' AND conversation_id = $2`,
      [other.id, req.user.id]
    );
    const otherUserReadUpTo = readResult.rows[0]?.last_read_at || null;

    res.json({ otherUser: other, messages, otherUserReadUpTo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't load that conversation" });
  }
});

// Mark a DM conversation as read up to now — powers unread counts in the
// chat list AND read receipts (the other person's checkmarks update live).
router.post("/with/:username/read", requireAuth, async (req, res) => {
  try {
    const otherResult = await pool.query("SELECT id FROM users WHERE username = $1", [req.params.username]);
    const other = otherResult.rows[0];
    if (!other) {
      return res.status(404).json({ error: `no user named '${req.params.username}'` });
    }

    const result = await pool.query(
      `INSERT INTO conversation_reads (user_id, conversation_type, conversation_id, last_read_at)
       VALUES ($1, 'dm', $2, now())
       ON CONFLICT (user_id, conversation_type, conversation_id)
       DO UPDATE SET last_read_at = now()
       RETURNING last_read_at`,
      [req.user.id, other.id]
    );

    emitToUser(other.id, "dm:read", {
      byUserId: req.user.id,
      readUpTo: result.rows[0].last_read_at,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't mark conversation as read" });
  }
});

// Edit a message — sender only, text messages only, can't edit a deleted message
router.patch("/:messageId", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "content is required" });
  }

  try {
    const existing = await pool.query("SELECT * FROM messages WHERE id = $1", [messageId]);
    const message = existing.rows[0];
    if (!message) return res.status(404).json({ error: "message not found" });
    if (message.sender_id !== req.user.id) {
      return res.status(403).json({ error: "you can only edit your own messages" });
    }
    if (message.type !== "text") {
      return res.status(400).json({ error: "only text messages can be edited" });
    }
    if (message.deleted_at) {
      return res.status(400).json({ error: "can't edit a deleted message" });
    }

    const result = await pool.query(
      "UPDATE messages SET content = $1, edited_at = now() WHERE id = $2 RETURNING content, edited_at",
      [content.trim(), messageId]
    );

    const payload = { messageId, content: result.rows[0].content, editedAt: result.rows[0].edited_at };
    emitToUser(message.sender_id, "message:edited", payload);
    emitToUser(message.receiver_id, "message:edited", payload);

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't edit that message" });
  }
});

// Delete a message — "me" hides it from just your own view, "everyone" (sender only)
// tombstones it for both people. ?mode=me|everyone, defaults to "me".
router.delete("/:messageId", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });
  const mode = req.query.mode === "everyone" ? "everyone" : "me";

  try {
    const existing = await pool.query("SELECT * FROM messages WHERE id = $1", [messageId]);
    const message = existing.rows[0];
    if (!message) return res.status(404).json({ error: "message not found" });

    const isParticipant = message.sender_id === req.user.id || message.receiver_id === req.user.id;
    if (!isParticipant) {
      return res.status(403).json({ error: "you're not part of this conversation" });
    }

    if (mode === "me") {
      await pool.query(
        `INSERT INTO hidden_messages (user_id, message_kind, message_id)
         VALUES ($1, 'dm', $2) ON CONFLICT DO NOTHING`,
        [req.user.id, messageId]
      );
      return res.json({ deleted: messageId, mode: "me" });
    }

    // mode === "everyone"
    if (message.sender_id !== req.user.id) {
      return res.status(403).json({ error: "only the sender can delete a message for everyone" });
    }

    const result = await pool.query(
      "UPDATE messages SET deleted_at = now() WHERE id = $1 RETURNING deleted_at",
      [messageId]
    );

    const payload = { messageId, deletedAt: result.rows[0].deleted_at };
    emitToUser(message.sender_id, "message:deleted", payload);
    emitToUser(message.receiver_id, "message:deleted", payload);

    res.json({ deleted: messageId, mode: "everyone" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't delete that message" });
  }
});

const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Toggle a quick emoji reaction on a message — same emoji from the same
// person removes it, matching how most chat apps handle re-clicking.
router.post("/:messageId/reactions", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  const { emoji } = req.body;
  if (!ALLOWED_REACTIONS.includes(emoji)) {
    return res.status(400).json({ error: `emoji must be one of: ${ALLOWED_REACTIONS.join(" ")}` });
  }

  try {
    const msgResult = await pool.query("SELECT sender_id, receiver_id FROM messages WHERE id = $1", [messageId]);
    const message = msgResult.rows[0];
    if (!message) return res.status(404).json({ error: "message not found" });

    const isParticipant = message.sender_id === req.user.id || message.receiver_id === req.user.id;
    if (!isParticipant) return res.status(403).json({ error: "you're not part of this conversation" });

    const existing = await pool.query(
      "SELECT 1 FROM message_reactions WHERE message_kind = 'dm' AND message_id = $1 AND user_id = $2 AND emoji = $3",
      [messageId, req.user.id, emoji]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        "DELETE FROM message_reactions WHERE message_kind = 'dm' AND message_id = $1 AND user_id = $2 AND emoji = $3",
        [messageId, req.user.id, emoji]
      );
    } else {
      await pool.query(
        "INSERT INTO message_reactions (message_kind, message_id, user_id, emoji) VALUES ('dm', $1, $2, $3)",
        [messageId, req.user.id, emoji]
      );
    }

    const agg = await pool.query(
      `SELECT emoji, COUNT(*)::int AS count, ARRAY_AGG(user_id) AS user_ids
       FROM message_reactions WHERE message_kind = 'dm' AND message_id = $1 GROUP BY emoji`,
      [messageId]
    );

    const payload = { messageId, reactions: agg.rows.map((r) => ({ emoji: r.emoji, count: r.count, userIds: r.user_ids })) };
    emitToUser(message.sender_id, "message:reaction", payload);
    emitToUser(message.receiver_id, "message:reaction", payload);

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't update reaction" });
  }
});

// Forward a message into a DM or a group. Exactly one of toUsername/toGroupId
// must be provided. The forwarded copy is a brand-new message (so it can be
// edited/deleted independently), carrying who it originally came from.
router.post("/:messageId/forward", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  const { toUsername, toGroupId } = req.body;
  if (!toUsername && !toGroupId) {
    return res.status(400).json({ error: "provide toUsername or toGroupId" });
  }
  if (toUsername && toGroupId) {
    return res.status(400).json({ error: "provide only one of toUsername or toGroupId" });
  }

  try {
    const sourceResult = await pool.query(
      `SELECT m.*, u.username AS sender_username FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
      [messageId]
    );
    const source = sourceResult.rows[0];
    if (!source) return res.status(404).json({ error: "message not found" });
    if (source.deleted_at) return res.status(400).json({ error: "can't forward a deleted message" });

    const isParticipant = source.sender_id === req.user.id || source.receiver_id === req.user.id;
    if (!isParticipant) return res.status(403).json({ error: "you're not part of this conversation" });

    if (toUsername) {
      const receiverResult = await pool.query("SELECT id FROM users WHERE username = $1", [toUsername]);
      const receiver = receiverResult.rows[0];
      if (!receiver) return res.status(404).json({ error: `no user named '${toUsername}'` });
      if (receiver.id === req.user.id) return res.status(400).json({ error: "you can't message yourself" });

      const result = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, content, type, forwarded_from_username)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, sender_id, receiver_id, content, type, forwarded_from_username, delivered_at, created_at`,
        [req.user.id, receiver.id, source.content, source.type, source.sender_username]
      );
      const message = result.rows[0];
      emitToUser(receiver.id, "message:new", message);
      emitToUser(req.user.id, "message:new", message);
      return res.status(201).json(message);
    }

    // toGroupId — verify membership before allowing the forward
    const groupId = parseInt(toGroupId, 10);
    const memberCheck = await pool.query("SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2", [
      groupId,
      req.user.id,
    ]);
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: "you're not a member of that group" });
    }

    const result = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, content, type, forwarded_from_username)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sender_id, content, type, forwarded_from_username, created_at`,
      [groupId, req.user.id, source.content, source.type, source.sender_username]
    );
    const message = { ...result.rows[0], sender_username: req.user.username, group_id: groupId };
    emitToGroup(groupId, "group_message:new", message);
    res.status(201).json(message);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't forward that message" });
  }
});

// Pin / unpin — either DM participant can do this, it's a shared conversation
router.post("/:messageId/pin", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  try {
    const existing = await pool.query("SELECT sender_id, receiver_id FROM messages WHERE id = $1", [messageId]);
    const message = existing.rows[0];
    if (!message) return res.status(404).json({ error: "message not found" });
    const isParticipant = message.sender_id === req.user.id || message.receiver_id === req.user.id;
    if (!isParticipant) return res.status(403).json({ error: "you're not part of this conversation" });

    const result = await pool.query("UPDATE messages SET pinned_at = now() WHERE id = $1 RETURNING pinned_at", [
      messageId,
    ]);
    const payload = { messageId, pinnedAt: result.rows[0].pinned_at };
    emitToUser(message.sender_id, "message:pinned", payload);
    emitToUser(message.receiver_id, "message:pinned", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't pin that message" });
  }
});

router.post("/:messageId/unpin", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  try {
    const existing = await pool.query("SELECT sender_id, receiver_id FROM messages WHERE id = $1", [messageId]);
    const message = existing.rows[0];
    if (!message) return res.status(404).json({ error: "message not found" });
    const isParticipant = message.sender_id === req.user.id || message.receiver_id === req.user.id;
    if (!isParticipant) return res.status(403).json({ error: "you're not part of this conversation" });

    await pool.query("UPDATE messages SET pinned_at = NULL WHERE id = $1", [messageId]);
    const payload = { messageId };
    emitToUser(message.sender_id, "message:unpinned", payload);
    emitToUser(message.receiver_id, "message:unpinned", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't unpin that message" });
  }
});

// Star / bookmark — toggle, private to the user
router.post("/:messageId/star", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (Number.isNaN(messageId)) return res.status(400).json({ error: "invalid message id" });

  try {
    const existing = await pool.query("SELECT sender_id, receiver_id FROM messages WHERE id = $1", [messageId]);
    const message = existing.rows[0];
    if (!message) return res.status(404).json({ error: "message not found" });
    const isParticipant = message.sender_id === req.user.id || message.receiver_id === req.user.id;
    if (!isParticipant) return res.status(403).json({ error: "you're not part of this conversation" });

    const already = await pool.query(
      "SELECT 1 FROM starred_messages WHERE user_id = $1 AND message_kind = 'dm' AND message_id = $2",
      [req.user.id, messageId]
    );
    if (already.rows.length > 0) {
      await pool.query("DELETE FROM starred_messages WHERE user_id = $1 AND message_kind = 'dm' AND message_id = $2", [
        req.user.id,
        messageId,
      ]);
      return res.json({ messageId, starred: false });
    }
    await pool.query("INSERT INTO starred_messages (user_id, message_kind, message_id) VALUES ($1, 'dm', $2)", [
      req.user.id,
      messageId,
    ]);
    res.json({ messageId, starred: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "couldn't update starred status" });
  }
});

module.exports = router;
